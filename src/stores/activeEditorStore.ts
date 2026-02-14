/**
 * Active Editor Store
 *
 * Purpose: Tracks the currently focused editor instance (Tiptap or CodeMirror)
 *   so the unified menu dispatcher can route actions to the correct editor.
 *
 * Key decisions:
 *   - Separate refs for WYSIWYG (Tiptap) and Source (CodeMirror) — only one
 *     should be non-null at a time, but both are tracked to avoid timing issues.
 *   - Conditional clear methods (clearWysiwygEditorIfMatch/clearSourceViewIfMatch)
 *     prevent a stale blur event from clearing a newly focused editor.
 *     @edge-case: Without this guard, rapid click from Source → WYSIWYG would
 *     clear the WYSIWYG ref when Source's blur fires after WYSIWYG's focus.
 *
 * @coordinates-with useUnifiedMenuCommands.ts — reads active editor to dispatch actions
 * @coordinates-with tiptapEditorStore.ts — similar but for toolbar context, not menu routing
 * @module stores/activeEditorStore
 */

import { create } from "zustand";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView as CodeMirrorView } from "@codemirror/view";

interface ActiveEditorState {
  /** Currently active WYSIWYG editor instance */
  activeWysiwygEditor: TiptapEditor | null;

  /** Currently active Source editor view instance */
  activeSourceView: CodeMirrorView | null;

  /** Set the active WYSIWYG editor */
  setActiveWysiwygEditor: (editor: TiptapEditor | null) => void;

  /** Set the active Source view */
  setActiveSourceView: (view: CodeMirrorView | null) => void;

  /**
   * Clear the WYSIWYG editor only if it matches the given instance.
   * Use this on blur/unmount to avoid clearing a newly active editor.
   */
  clearWysiwygEditorIfMatch: (editor: TiptapEditor) => void;

  /**
   * Clear the Source view only if it matches the given instance.
   * Use this on blur/unmount to avoid clearing a newly active view.
   */
  clearSourceViewIfMatch: (view: CodeMirrorView) => void;

  /** Clear all active editors */
  clearActiveEditors: () => void;
}

/**
 * Store for tracking active editor instances.
 *
 * Components should call setActiveWysiwygEditor/setActiveSourceView when their
 * editor gains focus. On blur/unmount, use the conditional clear methods
 * (clearWysiwygEditorIfMatch/clearSourceViewIfMatch) to avoid race conditions
 * where a blur from an old editor clears a newly active one.
 *
 * The unified menu dispatcher uses these to route actions to the correct editor.
 */
export const useActiveEditorStore = create<ActiveEditorState>((set, get) => ({
  activeWysiwygEditor: null,
  activeSourceView: null,

  setActiveWysiwygEditor: (editor) => {
    set({ activeWysiwygEditor: editor });
  },

  setActiveSourceView: (view) => {
    set({ activeSourceView: view });
  },

  clearWysiwygEditorIfMatch: (editor) => {
    if (get().activeWysiwygEditor === editor) {
      set({ activeWysiwygEditor: null });
    }
  },

  clearSourceViewIfMatch: (view) => {
    if (get().activeSourceView === view) {
      set({ activeSourceView: null });
    }
  },

  clearActiveEditors: () => {
    set({ activeWysiwygEditor: null, activeSourceView: null });
  },
}));
