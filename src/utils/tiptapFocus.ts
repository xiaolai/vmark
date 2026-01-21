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
      // Fresh document load: prevent unwanted scroll to middle
      const scrollContainer = getScrollContainer(view);
      const savedScrollTop = scrollContainer?.scrollTop ?? 0;

      try {
        view.focus();
      } catch {
        return;
      }

      // Set selection to start of document (ProseMirror may have placed it elsewhere)
      try {
        const tr = view.state.tr.setSelection(Selection.atStart(view.state.doc));
        view.dispatch(tr);
      } catch {
        // Ignore selection errors
      }

      // Restore scroll position (browser may have scrolled on focus)
      if (scrollContainer) {
        scrollContainer.scrollTop = savedScrollTop;
      }
    }
  };

  requestAnimationFrame(tryFocus);
}
