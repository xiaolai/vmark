/**
 * Multi-cursor keymap for ProseMirror
 *
 * Keyboard shortcuts:
 * - Mod-d: Select next occurrence
 * - Mod-Shift-d: Skip occurrence
 * - Mod-Shift-l: Select all occurrences
 * - Mod-Alt-z: Soft undo cursor
 * - Mod-Alt-ArrowUp: Add cursor above
 * - Mod-Alt-ArrowDown: Add cursor below
 * - Escape: Collapse to single cursor
 */
import { keymap } from "@tiptap/pm/keymap";
import type { Plugin, Transaction, EditorState } from "@tiptap/pm/state";
import {
  selectNextOccurrence,
  selectAllOccurrences,
  collapseMultiSelection,
  skipOccurrence,
  softUndoCursor,
  addCursorAbove,
  addCursorBelow,
} from "./commands";
import type { EditorView } from "@tiptap/pm/view";

type Command = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  view?: EditorView
) => boolean;

/**
 * Wrap a state-only transaction command into a ProseMirror command.
 */
function wrapCommand(
  fn: (state: EditorState) => Transaction | null
): Command {
  return (state, dispatch) => {
    const tr = fn(state);
    if (tr) {
      if (dispatch) dispatch(tr);
      return true;
    }
    return false;
  };
}

/**
 * Wrap a command that requires the EditorView into a ProseMirror command.
 */
function wrapViewCommand(
  fn: (state: EditorState, view: EditorView) => Transaction | null
): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const tr = fn(state, view);
    if (tr) {
      if (dispatch) dispatch(tr);
      return true;
    }
    return false;
  };
}

/**
 * Create the multi-cursor keymap plugin.
 */
export function multiCursorKeymap(): Plugin {
  return keymap({
    "Mod-d": wrapCommand(selectNextOccurrence),
    "Mod-Shift-l": wrapCommand(selectAllOccurrences),
    "Mod-Shift-d": wrapCommand(skipOccurrence),
    "Mod-Alt-z": wrapCommand(softUndoCursor),
    "Mod-Alt-ArrowUp": wrapViewCommand(addCursorAbove),
    "Mod-Alt-ArrowDown": wrapViewCommand(addCursorBelow),
    Escape: wrapCommand(collapseMultiSelection),
  });
}
