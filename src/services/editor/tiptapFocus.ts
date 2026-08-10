/**
 * Tiptap Focus Utilities
 *
 * Purpose: Manages focus acquisition and cursor restoration for the Tiptap WYSIWYG editor,
 * including scroll-to-cursor and retry logic for race conditions during mode switches.
 *
 * Key decisions:
 *   - Retries focus up to MAX_FOCUS_ATTEMPTS times with requestAnimationFrame to handle
 *     cases where editor DOM isn't ready yet after mode switch
 *   - Scroll restoration uses the editor's scroll container, not window scroll
 *   - Cursor position restoration preserves both anchor and head for selection ranges
 *   - No cursor means the reader never clicked, so the remembered SCROLL offset
 *     is restored instead of scrolling to the top (#1249). `restoreEditorScroll`
 *     owns the async-content problem that the old unconditional `scrollTop = 0`
 *     sidestepped; a tab with nothing remembered still lands at the top.
 *
 * @coordinates-with cursorSync/tiptap.ts — saves cursor position before mode switch
 * @coordinates-with Editor.tsx — calls focus functions after mode toggle
 * @coordinates-with scrollPosition.ts — the remembered reading position
 * @module utils/tiptapFocus
 */

import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { Selection } from "@tiptap/pm/state";
import type { CursorInfo } from "@/stores/documentStore";
import { getTiptapEditorView } from "./tiptapView";
import {
  findScrollContainer,
  getEditorScrollOffset,
  restoreEditorScroll,
} from "./scrollPosition";

const MAX_FOCUS_ATTEMPTS = 12;

/**
 * Marks a selection this module set ITSELF, so cursor tracking does not report
 * it as the reader placing a caret.
 *
 * Without it the caret reset below is indistinguishable from a click. On a
 * document big enough to parse slowly, the reset lands AFTER the 200ms
 * cursor-tracking gate opens, so a reader who never clicked acquires a
 * `cursorInfo` pointing at the first heading — and every later remount then
 * faithfully "restores" them to the top. Measured live on a 60k-character
 * document: `{sourceLine: 1, wordAtCursor: "Reading", nodeType: "heading"}`
 * after nothing but scrolling (#1249).
 */
export const PROGRAMMATIC_SELECTION_META = "vmark:programmaticSelection";

export function scheduleTiptapFocusAndRestore(
  editor: TiptapEditor,
  getCursorInfo: () => CursorInfo | null,
  restoreCursor: (view: EditorView, cursorInfo: CursorInfo) => void,
  tabId?: string,
): void {
  let attempts = 0;

  const tryFocus = () => {
    if (editor.isDestroyed) return;
    const view = getTiptapEditorView(editor);
    if (!view || !view.dom || !view.dom.isConnected) {
      attempts += 1;
      if (attempts < MAX_FOCUS_ATTEMPTS) {
        requestAnimationFrame(tryFocus);
      }
      return;
    }

    // Check cursor info BEFORE focus to distinguish fresh load vs mode switch
    const info = getCursorInfo();

    if (info) {
      // Mode switch: focus and restore cursor (which includes scrollIntoView)
      try {
        view.focus();
      } catch {
        return;
      }
      restoreCursor(view, info);
    } else {
      // No cursor: the reader has only been reading, so hand the viewport back
      // to wherever they left it — the top, for a document opened for the very
      // first time.

      try {
        view.focus();
      } catch {
        return;
      }

      // Set selection to start of document (ProseMirror may have placed it elsewhere)
      try {
        const tr = view.state.tr
          .setSelection(Selection.atStart(view.state.doc))
          .setMeta(PROGRAMMATIC_SELECTION_META, true) // ours, not the reader's
          .setMeta("addToHistory", false); // Don't pollute undo history during focus
        view.dispatch(tr);
      } catch {
        // Ignore selection errors
      }

      restoreEditorScroll(
        findScrollContainer(view.dom as HTMLElement),
        getEditorScrollOffset(tabId, "wysiwyg") ?? 0,
      );
    }
  };

  requestAnimationFrame(tryFocus);
}
