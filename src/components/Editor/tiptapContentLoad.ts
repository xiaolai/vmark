/**
 * Tiptap content loads
 *
 * Purpose: replace the WYSIWYG editor's whole document with content that did
 * not come from the user's typing — the initial load and the store→editor
 * sync — without an undo step, and without the editor writing its
 * re-serialization back to the store as an edit.
 *
 * Key decisions:
 *   - A load WAITS for an IME composition in progress (or just ended and not
 *     yet cleaned up) to settle (`writeWhenCompositionSettles`). A document
 *     replaced under the preedit text is committed or dropped by WebKit, and
 *     the composed text lands on top of the new document.
 *   - A waiting load is a function run later: it replaces the document as it
 *     is THEN, so text committed meanwhile cannot leave it with stale bounds.
 *   - A load that waited asks `stillWanted` before it runs. While it waited,
 *     the editor's own flush may have written what the user composed into the
 *     store, or a newer load may have been queued behind it; running it then
 *     would leave the editor showing a document the store no longer holds,
 *     with nothing left to sync them. A load applied at once is not asked.
 *   - The transaction carries `preventUpdate`: a load, not a user edit.
 *   - The write marks the editor as holding its document (`contentApplied`)
 *     when it dispatches, not when it is asked for: until then a flush would
 *     serialize the empty placeholder over the document's text.
 *
 * @coordinates-with services/ime/compositionWriteGate.ts — the wait
 * @coordinates-with services/editor/unparseableDocument.ts — a refused sync lands in Source mode
 * @coordinates-with TiptapEditor.tsx — the initial load
 * @coordinates-with useTiptapContentSync.ts — the store→editor sync
 * @coordinates-with useTiptapFlush.ts — the flush that can supersede a waiting load
 * @coordinates-with contentApplied.ts — records that a load has been written
 * @module components/Editor/tiptapContentLoad
 */
import type { MutableRefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { getTiptapEditorView } from "@/services/editor/tiptapView";
import { reportUnparseableDocument } from "@/services/editor/unparseableDocument";
import { type GatedWrite, writeWhenCompositionSettles } from "@/services/ime/compositionWriteGate";
import { markContentApplied } from "./contentApplied";

/**
 * Set editor content without adding to undo history.
 * Tiptap's setContent in v3.x does NOT exclude from history by default,
 * so we use a direct ProseMirror transaction with addToHistory: false.
 *
 * Returns `"deferred"` when an IME composition made the load wait; it then
 * runs once the composition has settled, if `stillWanted()` still says so.
 */
export function setContentWithoutHistory(
  editor: TiptapEditor,
  doc: PMNode,
  stillWanted: () => boolean = () => true,
): GatedWrite {
  const view = getTiptapEditorView(editor);
  if (!view) {
    // Fallback to standard setContent if view not available
    editor.commands.setContent(doc, { emitUpdate: false });
    markContentApplied(editor);
    return "applied";
  }

  let waited = false;
  const outcome = writeWhenCompositionSettles(view, () => {
    if (waited && !stillWanted()) return;
    const { state } = view;
    const tr = state.tr
      .replaceWith(0, state.doc.content.size, doc.content)
      .setMeta("addToHistory", false)
      .setMeta("preventUpdate", true); // Don't emit update event
    view.dispatch(tr);
    markContentApplied(editor);
  });
  waited = outcome === "deferred";
  return outcome;
}

/**
 * Parse markdown and sync it into the editor without touching undo history.
 * Updates lastExternalContent tracking ref on success.
 * Returns true if content was synced, false if already current, still waiting
 * for an IME composition to settle, or on error.
 *
 * A load that waits is dropped if, by the time it would run, the tracking ref
 * has moved on: a newer sync or the editor's own flush superseded it.
 *
 * A document that cannot be parsed is reported for `tabId`: the editor
 * keeps its old content, and an edit there would overwrite the new text on
 * the next flush, so it goes to Source mode with a message instead.
 */
export function syncMarkdownToEditor(
  editor: TiptapEditor,
  markdown: string,
  lastExternalContent: MutableRefObject<string>,
  preserveLineBreaks: boolean,
  tabId: string | undefined,
): boolean {
  if (markdown === lastExternalContent.current) return false;
  try {
    const doc = parseMarkdown(editor.schema, markdown, { preserveLineBreaks });
    const outcome = setContentWithoutHistory(
      editor,
      doc,
      () => lastExternalContent.current === markdown,
    );
    lastExternalContent.current = markdown;
    return outcome === "applied";
  } catch (error) {
    reportUnparseableDocument(tabId, error);
    return false;
  }
}
