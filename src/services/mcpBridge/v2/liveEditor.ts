/**
 * Purpose: keep the mounted WYSIWYG editor and the document store in step
 * while a bridge handler reads or replaces a document.
 *
 * The store is what the bridge reads and saves, but while a tab is open in
 * WYSIWYG mode the EDITOR holds the truth and the store trails it: keystrokes
 * reach the store on a debounced flush (a frame for small documents, seconds
 * for large ones), and the store's text is the editor's serialization, not
 * whatever text was loaded into it. A handler that ignores either fact reports
 * a state that stops being true a frame later.
 *
 * Key decisions:
 *   - Flush BEFORE reading. `flushLiveEditors` brings pending keystrokes into
 *     the store (bumping the revision as an edit does), so a read returns what
 *     the user sees, a save writes it, and a write based on an older read is
 *     refused as stale instead of silently replacing typing it never saw.
 *     A flush that fails for the tab a handler targets is not read past: the
 *     handler is refused, since the store no longer holds what the user sees.
 *   - A replaced document is a LOAD, not typing. The transaction carries
 *     `preventUpdate`, the mark the editor's own content loads use, so the
 *     editor does not schedule a flush that would write its re-serialization
 *     back as a user edit — which re-dirtied a document one frame after it was
 *     reported saved. It stays in the undo history: the user can undo an AI
 *     write.
 *   - Flush AFTER loading. The store then holds exactly the text the editor
 *     serializes to, and the editor knows the store holds it, so its content
 *     sync does not parse and load the same document a second time.
 *     The consequence is deliberate: for the live WYSIWYG tab the buffer — and
 *     so what gets saved — is the editor's serialization of the client's text,
 *     not its exact characters. Disk, store and editor then agree, which no
 *     other choice can offer while the editor holds a parsed document.
 *   - That flush is the tab's own and its failure is NOT swallowed: the
 *     editor already holds the new document, so a store left behind it must
 *     not be read back, committed or reported as the write. The load throws;
 *     the journaled handler's `recover` (`recoverLiveWysiwyg`) retries the
 *     flush, and a second failure leaves the edit unrecorded and unclaimed.
 *   - A write into an editor with an IME composition in progress is REFUSED,
 *     not deferred. The browser owns the preedit text and its DOM node until
 *     the composition ends and is cleaned up; a replaced document under it is
 *     committed or dropped by WebKit. A handler must answer its client now, so
 *     it asks `liveCompositionRefusal` before it touches the store and answers
 *     BUSY; the client retries once the user has finished typing. The check
 *     covers BOTH editors registered for the tab — the WYSIWYG editor and a
 *     Source view (Source mode, a split's source pane, a YAML pane), each with
 *     its post-composition grace — and is the one check the BUSY answers and
 *     the post-prepare re-verify share.
 *   - An editor whose deferred initial load has not run is NOT loaded: its
 *     flush writes nothing until then, so the store could not be brought to
 *     what it would hold. The load reports it did not take the content; the
 *     store keeps the caller's text, and the editor's own initial load and
 *     content sync bring it there.
 *   - Only the editor registered as the active WYSIWYG editor is loaded
 *     directly. A tab also mounted in an unfocused split pane is updated by
 *     that pane's own content sync — a `preventUpdate` load, which the
 *     revision tracker does not count as a change.
 *
 * @coordinates-with utils/wysiwygFlush.ts — the flusher registry
 * @coordinates-with components/Editor/useTiptapFlush.ts — what a flush does
 * @coordinates-with components/Editor/tiptapContentLoad.ts — the editor's own content loads
 * @coordinates-with services/editor/contentApplied.ts — whether the initial load has run
 * @coordinates-with services/mcpBridge/revisionTracker.ts — bumps on edits, not on `preventUpdate` loads
 * @coordinates-with services/ime/compositionWriteGate.ts — whether a composition is in progress
 * @coordinates-with utils/imeGuard.ts — Source composition state
 * @module services/mcpBridge/v2/liveEditor
 */
import { useEditorStore } from "@/stores/editorStore";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { flushAllWysiwygNow, flushWysiwygNow } from "@/utils/wysiwygFlush";
import { getSerializeOptions } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { mcpBridgeLog } from "@/utils/debug";
import { hasContentApplied } from "@/services/editor/contentApplied";
import { isCompositionInProgress } from "@/services/ime/compositionWriteGate";
import { isCodeMirrorComposing, isCodeMirrorInCompositionGrace } from "@/utils/imeGuard";
import type { Editor } from "@tiptap/core";
import type { V2Error } from "./types";

/**
 * Bring the document store up to date with every mounted WYSIWYG editor.
 * Call before a handler reads a tab's content, dirty flag or revision.
 *
 * Throws when the editor of `tabId` could not hand its text to the store — or,
 * with no `tabId`, when any editor could not: the store then trails what the
 * user sees, and a handler must refuse rather than read or replace it. Every
 * other editor is still flushed.
 */
export function flushLiveEditors(tabId?: string): void {
  const failed = flushAllWysiwygNow();
  const blocking = tabId === undefined ? [...failed.keys()] : failed.has(tabId) ? [tabId] : [];
  if (blocking.length === 0) return;
  for (const key of blocking) mcpBridgeLog("live editor flush failed:", key, failed.get(key));
  throw new Error(`The editor of ${blocking.join(", ")} could not synchronize its pending edits; retry shortly`);
}

/**
 * The refusal a bridge write gets while the editor it would change has an IME
 * composition in progress. BUSY: the state is transient, and the client
 * should retry shortly.
 */
export function composingRefusal(): V2Error {
  return {
    error: "BUSY",
    message: "The user is composing text with an input method in this document; retry shortly",
  };
}

/** The live WYSIWYG editor, when it is showing `tabId`. */
function liveWysiwygEditor(tabId: string): Editor | null {
  const { tiptap, active } = useEditorStore.getState();
  const editor = tiptap.editor;
  return editor && active.activeWysiwygTabId === tabId ? editor : null;
}

/** Whether the Source view registered for `tabId` is composing or in its grace. */
function liveSourceComposing(tabId: string): boolean {
  const { active } = useEditorStore.getState();
  const view = active.activeSourceTabId === tabId ? active.activeSourceView : null;
  return isCodeMirrorComposing(view) || isCodeMirrorInCompositionGrace(view);
}

/**
 * The refusal for a write to `tabId` while a live editor showing it — the
 * WYSIWYG editor or the Source view registered for it — has an IME
 * composition in progress or just ended; `null` when the write may go ahead
 * (no editor shows the tab, or nobody is composing in one that does).
 *
 * Ask BEFORE changing the store: a refused write must change nothing.
 */
export function liveCompositionRefusal(tabId: string): V2Error | null {
  const editor = liveWysiwygEditor(tabId);
  const composing = (editor !== null && isCompositionInProgress(editor.view)) || liveSourceComposing(tabId);
  return composing ? composingRefusal() : null;
}

/**
 * Show `content` in the live WYSIWYG editor, if `tabId` is the tab it is
 * showing, and bring the store to the text the editor now holds.
 *
 * Returns whether the editor took the content — decided by whether its
 * document changed, not by whether dispatch threw: a dispatch that applied
 * the new state and then threw still flushes. `false` means the store keeps
 * whatever the caller put there: the tab is in the background or in Source
 * mode (the live editor shows a different document, and dispatching into it
 * would replace that one), the editor's initial load has not run yet (it
 * holds a placeholder its flush never writes), or the content could not be parsed — the editor
 * then keeps its old document and its own content sync reports the tab as
 * unparseable and moves it to Source mode.
 *
 * Throws while an IME composition is in progress in that editor: the caller
 * was required to ask `liveCompositionRefusal` first and answer BUSY. Throws,
 * with the editor holding the new document, when the flush after the load
 * fails or the tab has no flusher: the store then trails the editor, and the
 * caller must run `recoverLiveWysiwyg` before reading it.
 */
export function loadIntoLiveWysiwyg(tabId: string, content: string): boolean {
  const editor = liveWysiwygEditor(tabId);
  if (!editor) return false;
  const view = editor.view;
  if (isCompositionInProgress(view)) {
    throw new Error("loadIntoLiveWysiwyg: an IME composition is in progress; ask liveCompositionRefusal first");
  }
  // @edge-case: the editor's deferred initial load has not run. It holds its
  // empty placeholder, and its flush writes nothing until that load does, so
  // a document dispatched now could never be brought into the store. The
  // store is the truth; the initial load and the content sync bring the
  // editor to it.
  if (!hasContentApplied(editor)) return false;
  const before = view.state.doc;
  try {
    const next = parseMarkdown(editor.schema, content, {
      preserveLineBreaks: getSerializeOptions().preserveLineBreaks,
    });
    view.dispatch(
      view.state.tr
        .replaceWith(0, view.state.doc.content.size, next.content)
        .setMeta("addToHistory", true)
        .setMeta("preventUpdate", true),
    );
  } catch (error) {
    if (view.state.doc === before) {
      // Not flushed: the editor still holds the OLD document, and flushing it
      // would write that over the content the caller just stored.
      mcpBridgeLog("live editor did not take the written content:", error);
      return false;
    }
    // @edge-case: the new state was applied and something after it threw (a
    // plugin view's update). The editor holds the new document, so the store
    // takes its serialization like any load — otherwise the caller would
    // commit and report text the editor does not hold.
    mcpBridgeLog("live editor took the written content, then threw:", error);
  }
  flushWysiwygNow(tabId);
  return true;
}

/**
 * After a load into the live editor threw: bring the store to the text the
 * editor holds by flushing it once more. Throws when that flush fails too —
 * the store cannot be brought into agreement, so nothing may be recorded as
 * the edit. A tab the live editor no longer shows is left alone: its store is
 * the document's truth.
 */
export function recoverLiveWysiwyg(tabId: string): void {
  if (liveWysiwygEditor(tabId)) flushWysiwygNow(tabId);
}
