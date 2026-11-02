/**
 * tiptapInitialLoad — the WYSIWYG editor's one-time initial load: parse the
 * tab's markdown into a fresh Tiptap editor and finish its setup (focus or
 * caret restore, a pending content-search jump, the toolbar context).
 *
 * Purpose: one body for both timings, so the immediate and the deferred path
 *   cannot drift apart. `startInitialLoad` picks the timing;
 *   `loadInitialContent` is the load itself.
 *
 * Key decisions:
 *   - A small document loads IMMEDIATELY, while the editor is committed, so the
 *     first painted frame already shows it. Every tab switch remounts the
 *     editor, and a deferred parse painted an empty editor first (#1634).
 *   - A large document, or any document opened under the "Opening large file…"
 *     indicator, still defers with `setTimeout(0)`: the shell and the
 *     indicator paint before the parse holds the main thread.
 *   - "Large" reuses the indicator's own cut, `SHOW_PROGRESS_BYTES` — the size
 *     below which an open is calibrated as perceptually instant — measured in
 *     UTF-8 bytes like the file size it was calibrated on, so CJK text (three
 *     bytes a character) is not under-counted by its UTF-16 length.
 *   - An immediate load runs in two phases. The document goes in during the
 *     commit; the setup with effects outside the editor (a parse-error report,
 *     a pending jump, focus restore, the toolbar context) waits for the
 *     component's passive effect. useEditor arms a 1 ms destroy timer when it
 *     builds an editor and disarms it only in its own passive effect, so a
 *     long non-discrete commit can let the timer win; the replacement editor
 *     must then still find the jump, and the dead one must report nothing.
 *   - The load is excluded from undo (`setContentWithoutHistory`); a parse
 *     failure unblocks external sync and lands in Source mode via
 *     `reportUnparseableDocument`, reporting the LATEST content if it drifted.
 *
 * @coordinates-with TiptapEditor.tsx — calls startInitialLoad once per editor instance
 * @coordinates-with tiptapContentLoad.ts — history-free load and external resync
 * @coordinates-with utils/fileSizeThresholds.ts — the indicator threshold reused here
 * @module components/Editor/tiptapInitialLoad
 */

import type { RefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { FILE_SIZE_THRESHOLDS } from "@/utils/fileSizeThresholds";
import { useFileLoadStore } from "@/stores/documentStore";
import type { CursorInfo } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { getTiptapEditorView } from "@/services/editor/tiptapView";
import { scheduleTiptapFocusAndRestore } from "@/services/editor/tiptapFocus";
import { reportUnparseableDocument } from "@/services/editor/unparseableDocument";
import { restoreCursorInTiptap } from "@/utils/cursorSync/tiptap";
import { extractTiptapContext } from "@/plugins/formatToolbar/tiptapContext";
import { consumeWysiwygPendingNav } from "./wysiwygPendingNav";
import { setContentWithoutHistory, syncMarkdownToEditor } from "./tiptapContentLoad";

/** The editor component's live state the load reads and writes. */
export interface InitialLoadRefs {
  /** Markdown last applied to the editor from outside; set by the load. */
  lastExternalContent: RefObject<string>;
  /** Gates external content sync; true once the load has run (or failed). */
  editorInitialized: RefObject<boolean>;
  /** The tab's current markdown — may drift from the snapshot while deferred. */
  contentRef: RefObject<string>;
  hiddenRef: RefObject<boolean>;
  previewRef: RefObject<boolean>;
  preserveLineBreaksRef: RefObject<boolean>;
  cursorInfoRef: RefObject<CursorInfo | null>;
  isFocusedPaneRef: RefObject<boolean>;
}

/** Whether the UTF-8 encoding of `text` is at least `limit` bytes. */
function utf8BytesAtLeast(text: string, limit: number): boolean {
  if (text.length >= limit) return true; // every UTF-16 unit is at least one byte
  if (text.length * 3 < limit) return false; // and at most three (a pair is 4 bytes for 2 units)
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3; // @edge-case lone high surrogate encodes as U+FFFD
    } else bytes += 3; // BMP above U+07FF, or a lone surrogate (U+FFFD)
    if (bytes >= limit) return true;
  }
  return false;
}

/**
 * Whether the initial parse must wait a task instead of running while the
 * editor is committed: always under the loading indicator (it has to paint),
 * otherwise when the document reaches the indicator's byte threshold.
 */
export function shouldDeferInitialParse(markdown: string, loadIndicatorActive: boolean): boolean {
  return loadIndicatorActive || utf8BytesAtLeast(markdown, FILE_SIZE_THRESHOLDS.SHOW_PROGRESS_BYTES);
}

/** The rest of an initial load: its setup with effects outside the editor. */
export type FinishInitialLoad = () => void;

/**
 * Parse `contentSnapshot` into `editor`. Returns the rest of the load — a
 * parse error to report, the focus/caret restore or pending jump, the toolbar
 * context — which does nothing if the editor has been destroyed by then.
 */
function loadInitialContent(
  editor: TiptapEditor,
  contentSnapshot: string,
  activeTabId: string | undefined,
  refs: InitialLoadRefs,
  endMountLoad: () => void,
): FinishInitialLoad {
  const skip: FinishInitialLoad = () => {};
  if (editor.isDestroyed) { endMountLoad(); return skip; } // @edge-case unmounted before the parse ran
  const { lastExternalContent, editorInitialized, contentRef, hiddenRef, previewRef } = refs;
  let unparseable: { error: unknown } | null = null;
  try {
    const doc = parseMarkdown(editor.schema, contentSnapshot, {
      preserveLineBreaks: refs.preserveLineBreaksRef.current,
    });
    // Keep the initial load out of the undo history.
    setContentWithoutHistory(editor, doc, () => lastExternalContent.current === contentSnapshot, contentSnapshot, lastExternalContent.current);
    lastExternalContent.current = contentSnapshot;
    editorInitialized.current = true;

    // If content drifted while a deferred parse was pending, sync the fresh
    // value now — the external-sync effect (gated on editorInitialized)
    // already skipped it and would not refire until the next content change.
    if (contentRef.current !== contentSnapshot && !hiddenRef.current) { // hidden: synced when shown
      syncMarkdownToEditor(editor, contentRef.current, lastExternalContent, refs.preserveLineBreaksRef.current, activeTabId);
    }
  } catch (error) {
    editorInitialized.current = true; // Unblock external sync even on parse error
    if (hiddenRef.current) { /* A hidden editor re-syncs, and reports, when shown */ }
    else if (contentRef.current !== contentSnapshot) syncMarkdownToEditor(editor, contentRef.current, lastExternalContent, refs.preserveLineBreaksRef.current, activeTabId); // report the LATEST content
    else unparseable = { error };
  } finally {
    endMountLoad();
  }

  return () => {
    // @edge-case Tiptap tore this editor down before its mount effect; its
    // replacement loads again, and must still find the jump.
    if (editor.isDestroyed) return;
    if (unparseable) reportUnparseableDocument(activeTabId, unparseable.error);

    const view = getTiptapEditorView(editor);

    // Focus/cursor restore once content is set — skipped for hidden/preview, restore-only
    // in an unfocused split pane (#1554). A pending content-search jump wins: the deferred
    // restore would clobber its selection, and the visibility effect never re-fires for it.
    if (!hiddenRef.current && !previewRef.current && !consumeWysiwygPendingNav(view, activeTabId)) {
      scheduleTiptapFocusAndRestore(editor, () => refs.cursorInfoRef.current, restoreCursorInTiptap, activeTabId, () => refs.isFocusedPaneRef.current);
    }

    if (view && !previewRef.current) {
      useEditorStore.getState().setTiptapContext(extractTiptapContext(editor.state), view);
    }
  };
}

/**
 * Start the initial load of a fresh editor. A small document is parsed in
 * now and the rest of the load is returned, for the caller to run once the
 * editor is known to be kept; a large one, or one under the indicator, loads
 * whole after a `setTimeout(0)` and nothing is returned.
 */
export function startInitialLoad(
  editor: TiptapEditor,
  activeTabId: string | undefined,
  refs: InitialLoadRefs,
): FinishInitialLoad | null {
  const contentSnapshot = refs.contentRef.current;

  // Clear the "Opening large file…" indicator once this editor is interactive — or
  // gone. Scoped to the load id captured now, so a stale completion cannot wipe a newer one.
  const fileLoad = useFileLoadStore.getState();
  const loadIdAtMount = fileLoad.active ? fileLoad.loadId : null;
  const endMountLoad = () => { if (loadIdAtMount !== null) useFileLoadStore.getState().endLoad(loadIdAtMount); };

  const load = () => loadInitialContent(editor, contentSnapshot, activeTabId, refs, endMountLoad);
  if (!shouldDeferInitialParse(contentSnapshot, loadIdAtMount !== null)) return load();
  setTimeout(() => load()(), 0);
  return null;
}
