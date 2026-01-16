/**
 * multiCursorPlugin - ProseMirror plugin for multi-cursor editing support
 *
 * Manages plugin state and coordinates multi-cursor functionality including:
 * - Tracking when MultiSelection is active
 * - Providing decorations for secondary cursors
 * - Handling input distribution across multiple cursors
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { MultiSelection } from "./MultiSelection";
import { createMultiCursorDecorations } from "./decorations";
import { handleMultiCursorInput, handleMultiCursorKeyDown } from "./inputHandling";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { handleMultiCursorPaste, getMultiCursorClipboardText } from "./clipboard";
import { addCursorAtPosition } from "./altClick";

/** Plugin state interface */
export interface MultiCursorPluginState {
  /** Whether a MultiSelection is currently active */
  isActive: boolean;
}

/** Plugin key for accessing multi-cursor state */
export const multiCursorPluginKey = new PluginKey<MultiCursorPluginState>(
  "multiCursor"
);

/**
 * Creates the multi-cursor ProseMirror plugin.
 *
 * This plugin:
 * - Tracks when MultiSelection is active in the editor
 * - Maintains MultiSelection through transactions
 * - Will provide decorations for secondary cursors (Phase 1.3)
 */
export function multiCursorPlugin(): Plugin<MultiCursorPluginState> {
  return new Plugin({
    key: multiCursorPluginKey,

    state: {
      init(): MultiCursorPluginState {
        return { isActive: false };
      },

      apply(
        _tr: Transaction,
        _value: MultiCursorPluginState,
        _oldState: EditorState,
        newState: EditorState
      ): MultiCursorPluginState {
        // Check if current selection is MultiSelection
        const isActive = newState.selection instanceof MultiSelection;
        return { isActive };
      },
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
      },
    },
  });
}
