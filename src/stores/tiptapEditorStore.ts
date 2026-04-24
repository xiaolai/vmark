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

/** Shape of the dev-only debug surface published on window for perf tooling. */
type VMarkDebug = { editorView: EditorView | null };

/**
 * Publish (or clear) the active EditorView on `window.__VMARK_DEBUG__` so
 * Tauri MCP perf scenarios (`scripts/perf/measure-webview.js`) can find the
 * live editor without ProseMirror internals. No-op in production (the
 * `import.meta.env.DEV` check makes the entire body dead code at build
 * time) and in non-DOM environments.
 */
function publishDebugEditorView(view: EditorView | null): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  (window as unknown as { __VMARK_DEBUG__?: VMarkDebug }).__VMARK_DEBUG__ = {
    editorView: view,
  };
}

/** Manages current Tiptap editor instance and cursor formatting context for toolbar display. Use selectors, not destructuring. */
export const useTiptapEditorStore = create<TiptapEditorState & TiptapEditorActions>((set) => ({
  ...initialState,

  setEditor: (editor) => {
    /* v8 ignore next -- @preserve null path for editor cleared on unmount */
    set({ editor, editorView: editor ? editor.view : null });
    publishDebugEditorView(editor ? editor.view : null);
  },

  setContext: (context, view) => {
    set({ context, editorView: view });
  },

  clear: () => {
    set(initialState);
    // Always reset the debug hook so perf tooling can't observe a stale
    // (potentially destroyed) view after unmount.
    publishDebugEditorView(null);
  },
}));
