/**
 * Tiptap Editor Store
 *
 * Purpose: Holds a reference to the current Tiptap editor instance and its
 *   cursor context (formatting state at cursor position). Used by toolbar
 *   and popup components to read/write editor state.
 *
 * Key decisions:
 *   - Separate from activeEditorStore which tracks focus for menu routing.
 *     This store is specifically for the WYSIWYG Tiptap instance and its
 *     toolbar context (bold active, heading level, list type, etc.).
 *   - Context updates on every selection change via toolbarContext plugin.
 *
 * @coordinates-with toolbarContext plugin — emits cursor context on selection change
 * @coordinates-with UniversalToolbar — reads context to show active formatting
 * @module stores/tiptapEditorStore
 */

import { create } from "zustand";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { CursorContext } from "@/plugins/toolbarContext/types";

interface TiptapEditorState {
  editor: TiptapEditor | null;
  editorView: EditorView | null;
  context: CursorContext | null;
}

interface TiptapEditorActions {
  setEditor: (editor: TiptapEditor | null) => void;
  setContext: (context: CursorContext, view: EditorView) => void;
  clear: () => void;
}

const initialState: TiptapEditorState = {
  editor: null,
  editorView: null,
  context: null,
};

export const useTiptapEditorStore = create<TiptapEditorState & TiptapEditorActions>((set) => ({
  ...initialState,

  setEditor: (editor) => {
    set({ editor, editorView: editor ? editor.view : null });
  },

  setContext: (context, view) => {
    set({ context, editorView: view });
  },

  clear: () => set(initialState),
}));
