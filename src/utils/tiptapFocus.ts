import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { CursorInfo } from "@/stores/documentStore";
import { getTiptapEditorView } from "./tiptapView";

const MAX_FOCUS_ATTEMPTS = 12;

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

    try {
      view.focus();
    } catch {
      return;
    }

    const info = getCursorInfo();
    if (info) {
      restoreCursor(view, info);
    }
  };

  requestAnimationFrame(tryFocus);
}
