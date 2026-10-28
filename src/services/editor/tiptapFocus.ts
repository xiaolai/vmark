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
 *     sidestepped; a tab with nothing remembered still lands at the top. The
 *     remembered block, when there is one, is what gets restored (#1473).
 *   - A cursor no longer wins by merely existing (#1556): `restoreChoice.ts`
 *     picks. On a return to WYSIWYG the caret is put back WITHOUT scrolling and
 *     the reading position is restored; on a switch from Source the cursor
 *     restore (with its scroll) carries the mapping, as before.
 *   - `canTakeFocus`, read when the frame fires, lets an unfocused split pane
 *     restore without focusing (#1554): the split tracks DOM focus as the
 *     focused pane, so a background pane focusing itself moved the pane focus.
 *   - The editor is marked restore-pending from schedule until the attempt
 *     runs, gives up or throws, so the bridge does not read the caret the
 *     restore is about to move as the reader's selection.
 *
 * @coordinates-with cursorSync/tiptap.ts — saves cursor position before mode switch
 * @coordinates-with Editor.tsx — calls focus functions after mode toggle
 * @coordinates-with scrollPosition.ts — the remembered reading position
 * @coordinates-with restoreChoice.ts — cursor or reading position
 * @coordinates-with caretRestorePending.ts — the pending mark
 * @module services/editor/tiptapFocus
 */

import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { Selection } from "@tiptap/pm/state";
import type { CursorInfo } from "@/stores/documentStore";
import { getTiptapEditorView } from "./tiptapView";
import {
  findScrollContainer,
  getEditorScrollAnchor,
  getEditorScrollOffset,
  restoreEditorScroll,
} from "./scrollPosition";
import { chooseEditorRestore } from "./restoreChoice";
import { beginCaretRestore } from "./caretRestorePending";

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
  restoreCursor: (view: EditorView, cursorInfo: CursorInfo, scrollIntoView: boolean) => void,
  tabId?: string,
  canTakeFocus: () => boolean = () => true,
): void {
  let attempts = 0;
  // Until the restore runs or is dropped, the editor's selection is not the
  // reader's; every exit below settles it except a retry, which hands it on.
  const settle = beginCaretRestore(editor);

  const tryFocus = () => {
    let retrying = false;
    try {
      retrying = focusAndRestore();
    } finally {
      if (!retrying) settle();
    }
  };

  /** One attempt; `true` when it scheduled another frame. */
  const focusAndRestore = (): boolean => {
    if (editor.isDestroyed) return false;
    const view = getTiptapEditorView(editor);
    if (!view || !view.dom || !view.dom.isConnected) {
      attempts += 1;
      if (attempts < MAX_FOCUS_ATTEMPTS) {
        requestAnimationFrame(tryFocus);
        return true;
      }
      return false;
    }

    // Check cursor info BEFORE focus to distinguish fresh load vs mode switch
    const info = getCursorInfo();
    const takeFocus = canTakeFocus();

    try {
      if (takeFocus) view.focus();
    } catch {
      return false;
    }

    const by = chooseEditorRestore(tabId, "wysiwyg", info !== null);

    if (info) {
      // The caret goes back either way; it scrolls into view only when it, and
      // not the remembered offset, is what puts the reader back (#1556).
      restoreCursor(view, info, by === "cursor");
      if (by === "cursor") return false;
    } else {
      // No cursor: the reader has only been reading. Set selection to start of
      // document (ProseMirror may have placed it elsewhere).
      try {
        const tr = view.state.tr
          .setSelection(Selection.atStart(view.state.doc))
          .setMeta(PROGRAMMATIC_SELECTION_META, true) // ours, not the reader's
          .setMeta("addToHistory", false); // Don't pollute undo history during focus
        view.dispatch(tr);
      } catch {
        // Ignore selection errors
      }
    }

    // Hand the viewport back to wherever the reader left it — the top, for a
    // document opened for the very first time. The block the reader left at
    // the top is what gets restored, when one was recorded (#1473).
    const at = getEditorScrollAnchor(tabId, "wysiwyg");
    restoreEditorScroll(
      findScrollContainer(view.dom as HTMLElement),
      getEditorScrollOffset(tabId, "wysiwyg") ?? 0,
      at ? { blocks: view.dom, at } : null,
    );
    return false;
  };

  requestAnimationFrame(tryFocus);
}
