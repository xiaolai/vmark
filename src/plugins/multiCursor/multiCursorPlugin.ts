/**
 * multiCursorPlugin - ProseMirror plugin for multi-cursor editing support
 *
 * Manages plugin state and coordinates multi-cursor functionality including:
 * - Tracking when MultiSelection is active
 * - Providing decorations for secondary cursors
 * - Handling input distribution across multiple cursors
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { MultiSelection } from "./MultiSelection";
import { createMultiCursorDecorations } from "./decorations";
import { handleMultiCursorInput, handleMultiCursorKeyDown } from "./inputHandling";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { handleMultiCursorPaste, handleMultiCursorCut, getMultiCursorClipboardText } from "./clipboard";
import { addCursorAtPosition } from "./altClick";

/** A snapshot of selection state for soft-undo history */
export interface SelectionSnapshot {
  ranges: Array<{ from: number; to: number }>;
  primaryIndex: number;
}

/** Plugin state interface */
export interface MultiCursorPluginState {
  /** Whether a MultiSelection is currently active */
  isActive: boolean;
  /** Selection history stack for soft-undo (Cmd+Alt+Z) */
  selectionHistory: SelectionSnapshot[];
}

/** Plugin key for accessing multi-cursor state */
export const multiCursorPluginKey = new PluginKey<MultiCursorPluginState>(
  "multiCursor"
);

/** Maximum number of selection history entries kept for soft-undo */
const MAX_SELECTION_HISTORY = 50;

/**
 * Creates the multi-cursor ProseMirror plugin.
 *
 * This plugin:
 * - Tracks when MultiSelection is active in the editor
 * - Maintains MultiSelection through transactions
 * - Provides decorations for secondary cursors
 * - Manages selection history for soft-undo
 */
export function multiCursorPlugin(): Plugin<MultiCursorPluginState> {
  return new Plugin({
    key: multiCursorPluginKey,

    state: {
      init(): MultiCursorPluginState {
        return { isActive: false, selectionHistory: [] };
      },

      apply(
        tr: Transaction,
        value: MultiCursorPluginState,
        oldState: EditorState,
        newState: EditorState
      ): MultiCursorPluginState {
        const isActive = newState.selection instanceof MultiSelection;
        let { selectionHistory } = value;

        const meta = tr.getMeta(multiCursorPluginKey);

        if (meta?.pushHistory) {
          // Push old selection onto history stack
          let snapshot: SelectionSnapshot;
          if (oldState.selection instanceof MultiSelection) {
            snapshot = {
              ranges: oldState.selection.ranges.map((r) => ({
                from: r.$from.pos,
                to: r.$to.pos,
              })),
              primaryIndex: oldState.selection.primaryIndex,
            };
          } else {
            snapshot = {
              ranges: [{
                from: oldState.selection.from,
                to: oldState.selection.to,
              }],
              primaryIndex: 0,
            };
          }
          const appended = [...selectionHistory, snapshot];
          selectionHistory = appended.length > MAX_SELECTION_HISTORY
            ? appended.slice(-MAX_SELECTION_HISTORY)
            : appended;
        } else if (Array.isArray(meta?.popHistory)) {
          // Pop handled by command — accept the validated stack
          selectionHistory = meta.popHistory as SelectionSnapshot[];
        } else if (tr.docChanged) {
          // Clear history on text edits
          selectionHistory = [];
        } else if (!isActive) {
          // Clear history when leaving multi-cursor mode
          selectionHistory = [];
        }

        return { isActive, selectionHistory };
      },
    },
    view(editorView) {
      const syncClass = (state: EditorState) => {
        const isActive = state.selection instanceof MultiSelection;
        editorView.dom.classList.toggle("multi-cursor-active", isActive);
      };

      syncClass(editorView.state);

      return {
        update(view) {
          syncClass(view.state);
        },
        destroy() {
          editorView.dom.classList.remove("multi-cursor-active");
        },
      };
    },

    props: {
      decorations(state: EditorState) {
        return createMultiCursorDecorations(state);
      },

      /**
       * Handle text input for multi-cursor.
       * Intercepts typed characters and distributes them to all cursors.
       */
      handleTextInput(
        view: EditorView,
        _from: number,
        _to: number,
        text: string
      ): boolean {
        const { state } = view;
        if (!(state.selection instanceof MultiSelection)) {
          return false;
        }
        if (view.composing) {
          return false;
        }

        const tr = handleMultiCursorInput(state, text, { isComposing: view.composing });
        if (tr) {
          view.dispatch(tr);
          return true;
        }
        return false;
      },

      /**
       * Handle click events for Alt+Click cursor creation.
       */
      handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
        // Alt+Click (Option+Click on macOS) to add cursor
        if (event.altKey) {
          const tr = addCursorAtPosition(view.state, pos);
          if (tr) {
            view.dispatch(tr);
            return true;
          }
        }
        return false;
      },

      /**
       * Handle key events for multi-cursor.
       * Handles backspace, delete, and other special keys.
       */
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        const { state } = view;
        if (!(state.selection instanceof MultiSelection)) {
          return false;
        }
        if (isImeKeyEvent(event)) {
          return false;
        }

        const tr = handleMultiCursorKeyDown(state, event);
        if (tr) {
          view.dispatch(tr);
          return true;
        }
        return false;
      },
      handlePaste(view: EditorView, event: ClipboardEvent): boolean {
        const { state } = view;
        if (!(state.selection instanceof MultiSelection)) {
          return false;
        }
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text) return false;
        const tr = handleMultiCursorPaste(state, text);
        if (tr) {
          view.dispatch(tr);
          event.preventDefault();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        copy(view, event) {
          const { state } = view;
          if (!(state.selection instanceof MultiSelection)) {
            return false;
          }
          const text = getMultiCursorClipboardText(state);
          if (!text) return false;
          event.preventDefault();
          event.clipboardData?.setData("text/plain", text);
          return true;
        },
        cut(view, event) {
          const { state } = view;
          if (!(state.selection instanceof MultiSelection)) {
            return false;
          }
          const text = getMultiCursorClipboardText(state);
          if (text) {
            event.clipboardData?.setData("text/plain", text);
          }
          const tr = handleMultiCursorCut(state);
          if (tr) {
            event.preventDefault();
            view.dispatch(tr);
            return true;
          }
          return false;
        },
      },
    },
  });
}
