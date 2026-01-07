import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

export function getTiptapEditorView(editor: TiptapEditor | null): EditorView | null {
  if (!editor) return null;
  try {
    return editor.view;
  } catch {
    return null;
  }
}

export function getTiptapEditorDom(view: EditorView | null): HTMLElement | null {
  if (!view) return null;
  try {
    const dom = view.dom as HTMLElement;
    if (!dom || !dom.isConnected) return null;
    return dom;
  } catch {
    return null;
  }
}
