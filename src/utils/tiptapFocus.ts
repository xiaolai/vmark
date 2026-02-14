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
 *
 * @coordinates-with cursorSync/tiptap.ts — saves cursor position before mode switch
 * @coordinates-with Editor.tsx — calls focus functions after mode toggle
 * @module utils/tiptapFocus
 */

import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { Selection } from "@tiptap/pm/state";
import type { CursorInfo } from "@/stores/documentStore";
import { getTiptapEditorView } from "./tiptapView";

const MAX_FOCUS_ATTEMPTS = 12;

/**
 * Find the scrollable container for the editor view.
 * Returns the editor's scroll parent or the editor DOM itself.
 */
function getScrollContainer(view: EditorView): HTMLElement | null {
  let el: HTMLElement | null = view.dom;
  while (el) {
    try {
      const style = getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return el;
      }
    } catch {
      // getComputedStyle may fail on mock elements in tests
      break;
    }
    el = el.parentElement;
  }
  return view.dom.parentElement;
}

export function scheduleTiptapFocusAndRestore(
  editor: TiptapEditor,
  getCursorInfo: () => CursorInfo | null,
  restoreCursor: (view: EditorView, cursorInfo: CursorInfo) => void
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
      // Fresh document load: ensure cursor at start and scroll to top.
      // Note: We don't save/restore scroll position because content may have
      // been loaded asynchronously (e.g., via useFinderFileOpen for cold start),
      // which could cause the browser to auto-scroll before this RAF runs.
      // Always scrolling to 0 ensures a consistent initial view.

      try {
        view.focus();
      } catch {
        return;
      }

      // Set selection to start of document (ProseMirror may have placed it elsewhere)
      try {
        const tr = view.state.tr
          .setSelection(Selection.atStart(view.state.doc))
          .setMeta("addToHistory", false); // Don't pollute undo history during focus
        view.dispatch(tr);
      } catch {
        // Ignore selection errors
      }

      // Always scroll to top for fresh document loads
      const scrollContainer = getScrollContainer(view);
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
    }
  };

  requestAnimationFrame(tryFocus);
}
