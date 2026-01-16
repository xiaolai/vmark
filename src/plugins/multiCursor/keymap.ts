/**
 * Multi-cursor keymap for ProseMirror
 *
 * Keyboard shortcuts:
 * - Mod-d: Select next occurrence
 * - Mod-Shift-l: Select all occurrences
 * - Escape: Collapse to single cursor
 */
import { keymap } from "@tiptap/pm/keymap";
import type { Plugin, Transaction, EditorState } from "@tiptap/pm/state";
import {
  selectNextOccurrence,
  selectAllOccurrences,
  collapseMultiSelection,
} from "./commands";
import type { EditorView } from "@tiptap/pm/view";

type Command = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  view?: EditorView
) => boolean;

/**
 * Wrap a transaction-returning command into a ProseMirror command.
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
 * Create the multi-cursor keymap plugin.
 *
 * Shortcuts:
 * - Mod-d: Select next occurrence (same as VSCode/Sublime)
 * - Mod-Shift-l: Select all occurrences (same as VSCode)
 * - Escape: Collapse multi-selection to single cursor
 */
export function multiCursorKeymap(): Plugin {
  return keymap({
    "Mod-d": wrapCommand(selectNextOccurrence),
    "Mod-Shift-l": wrapCommand(selectAllOccurrences),
    Escape: wrapCommand(collapseMultiSelection),
  });
}
