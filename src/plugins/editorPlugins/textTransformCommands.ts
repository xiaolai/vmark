/**
 * Purpose: Text transformation shortcut handlers for WYSIWYG mode.
 *
 * Exports:
 * - doWysiwygTransformUppercase
 * - doWysiwygTransformLowercase
 * - doWysiwygTransformTitleCase
 * - doWysiwygTransformToggleCase
 *
 * @coordinates-with editorPlugins.tiptap.ts (keymap builder binds these)
 * @coordinates-with utils/textTransformations.ts (transformation logic)
 */

import type { EditorView } from "@tiptap/pm/view";
import {
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toggleCase,
} from "@/utils/textTransformations";

// --- Text transformation helpers for WYSIWYG ---

function wysiwygTransformSelection(view: EditorView, transform: (text: string) => string): boolean {
  const { state, dispatch } = view;
  const { from, to } = state.selection;
  if (from === to) return false; // No selection

  const selectedText = state.doc.textBetween(from, to, "");
  const transformed = transform(selectedText);

  if (transformed !== selectedText) {
    dispatch(state.tr.insertText(transformed, from, to));
    view.focus();
  }
  return true;
}

export function doWysiwygTransformUppercase(view: EditorView): boolean {
  return wysiwygTransformSelection(view, toUpperCase);
}

export function doWysiwygTransformLowercase(view: EditorView): boolean {
  return wysiwygTransformSelection(view, toLowerCase);
}

export function doWysiwygTransformTitleCase(view: EditorView): boolean {
  return wysiwygTransformSelection(view, toTitleCase);
}

export function doWysiwygTransformToggleCase(view: EditorView): boolean {
  return wysiwygTransformSelection(view, toggleCase);
}
