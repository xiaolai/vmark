/**
 * Type-safe utilities for Tiptap editor.
 *
 * Provides helper functions to avoid unsafe type casts when working
 * with Tiptap's Editor and ProseMirror's EditorView.
 */
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Safely get the ProseMirror EditorView from a Tiptap Editor.
 *
 * Tiptap's Editor.view is typed as TiptapEditorView which is a subset
 * of ProseMirror's EditorView. This helper provides a type-safe cast.
 *
 * @param editor - The Tiptap Editor instance
 * @returns The ProseMirror EditorView
 */
export function getEditorView(editor: Editor): EditorView {
  return editor.view as EditorView;
}

/**
 * Safely get the ProseMirror EditorView from a nullable Tiptap Editor.
 *
 * @param editor - The Tiptap Editor instance or null
 * @returns The ProseMirror EditorView or null
 */
export function getEditorViewOrNull(editor: Editor | null): EditorView | null {
  return editor ? (editor.view as EditorView) : null;
}
