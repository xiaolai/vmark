/**
 * Active Editor Store
 *
 * Purpose: Tracks the currently focused editor instance (Tiptap or CodeMirror)
 *   AND the tab id it was bound to, so consumers (menu dispatcher, MCP
 *   selection handlers) can verify the editor still belongs to the tab they
 *   intend to act on before using it.
 *
 * Key decisions:
 *   - Separate refs for WYSIWYG (Tiptap) and Source (CodeMirror) — only one
 *     should be non-null at a time, but both are tracked to avoid timing issues.
 *   - Each ref carries its owning tabId. Selection-style operations check
 *     `activeWysiwygTabId === focusedTabId` (or source equivalent) before
 *     reading editor state, eliminating the cross-tab drift window where a
 *     stale ref from a previously-focused tab is treated as authoritative.
 *   - Conditional clear methods (clearWysiwygEditorIfMatch/clearSourceViewIfMatch)
 *     prevent a stale blur event from clearing a newly focused editor.
 *     @edge-case: Without this guard, rapid click from Source → WYSIWYG would
 *     clear the WYSIWYG ref when Source's blur fires after WYSIWYG's focus.
 *
 * @coordinates-with useUnifiedMenuCommands.ts — reads active editor to dispatch actions
 * @coordinates-with hooks/mcpBridge/v2/selection.ts — verifies tabId binding before mutation
 * @coordinates-with tiptapEditorStore.ts — similar but for toolbar context, not menu routing
 * @module stores/activeEditorStore
 */

import { create } from "zustand";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView as CodeMirrorView } from "@codemirror/view";

interface ActiveEditorState {
  /** Currently active WYSIWYG editor instance */
  activeWysiwygEditor: TiptapEditor | null;

  /** Tab id the active WYSIWYG editor is bound to */
  activeWysiwygTabId: string | null;

  /** Currently active Source editor view instance */
  activeSourceView: CodeMirrorView | null;

  /** Tab id the active source view is bound to */
  activeSourceTabId: string | null;

  /**
   * Set the active WYSIWYG editor and the tab it belongs to. Pass `null`
   * for `editor` to clear; `tabId` may be omitted only when clearing.
   */
  setActiveWysiwygEditor: (
    editor: TiptapEditor | null,
    tabId?: string | null,
  ) => void;

  /**
   * Set the active Source view and the tab it belongs to. Pass `null`
   * for `view` to clear; `tabId` may be omitted only when clearing.
   */
  setActiveSourceView: (
    view: CodeMirrorView | null,
    tabId?: string | null,
  ) => void;

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
 * Store for tracking active editor instances and their owning tab.
 *
 * Components should call setActiveWysiwygEditor/setActiveSourceView with the
 * tabId when their editor gains focus. On blur/unmount, use the conditional
 * clear methods (clearWysiwygEditorIfMatch/clearSourceViewIfMatch) to avoid
 * race conditions where a blur from an old editor clears a newly active one.
 *
 * The unified menu dispatcher uses the editor refs to route actions; the MCP
 * selection handlers additionally verify the bound tabId matches the focused
 * tab before reading or mutating editor state.
 */
export const useActiveEditorStore = create<ActiveEditorState>((set, get) => ({
  activeWysiwygEditor: null,
  activeWysiwygTabId: null,
  activeSourceView: null,
  activeSourceTabId: null,

  setActiveWysiwygEditor: (editor, tabId) => {
    set({
      activeWysiwygEditor: editor,
      activeWysiwygTabId: editor ? (tabId ?? null) : null,
    });
  },

  setActiveSourceView: (view, tabId) => {
    set({
      activeSourceView: view,
      activeSourceTabId: view ? (tabId ?? null) : null,
    });
  },

  clearWysiwygEditorIfMatch: (editor) => {
    if (get().activeWysiwygEditor === editor) {
      set({ activeWysiwygEditor: null, activeWysiwygTabId: null });
    }
  },

  clearSourceViewIfMatch: (view) => {
    if (get().activeSourceView === view) {
      set({ activeSourceView: null, activeSourceTabId: null });
    }
  },

  clearActiveEditors: () => {
    set({
      activeWysiwygEditor: null,
      activeWysiwygTabId: null,
      activeSourceView: null,
      activeSourceTabId: null,
    });
  },
}));
