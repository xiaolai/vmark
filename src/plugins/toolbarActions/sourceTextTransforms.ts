/**
 * Source Text Transforms
 *
 * Line operations and text case transformations for source (CodeMirror) mode.
 * Extracted from sourceAdapter.ts to keep files under ~300 lines.
 *
 * @coordinates-with sourceAdapter.ts — main dispatcher imports these handlers
 * @module plugins/toolbarActions/sourceTextTransforms
 */

import type { EditorView } from "@codemirror/view";
import {
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toggleCase,
  removeBlankLines,
  duplicateLines,
  deleteLines,
  joinLines,
  sortLinesAscending,
  sortLinesDescending,
} from "@/utils/textTransformations";
import { moveBlockAware, joinWouldFuseBlocks, duplicateNeedsHardBreak } from "./sourceBlockMove";

// --- Line operations ---

/** Moves the current line (or selected lines) up by one position in source mode. */
export function handleMoveLineUp(view: EditorView): boolean {
  return moveLines(view, "up");
}

/**
 * Move the selected lines, treating a blank line as a block separator rather
 * than as something to swap with — swapping across one merges two paragraphs.
 */
function moveLines(view: EditorView, direction: "up" | "down"): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.doc.toString();
  const lines = text.split("\n");
  const selection = {
    start: state.doc.lineAt(from).number - 1,
    end: state.doc.lineAt(to).number - 1,
  };

  const moved = moveBlockAware(lines, selection, direction);
  if (!moved) return false;

  const newText = moved.join("\n");
  // Re-anchor on the moved text rather than on an offset arithmetic that the
  // block case would get wrong.
  const movedText = lines.slice(selection.start, selection.end + 1).join("\n");
  const anchor = Math.max(0, newText.indexOf(movedText));

  view.dispatch({
    changes: { from: 0, to: text.length, insert: newText },
    selection: { anchor, head: anchor + movedText.length },
  });
  view.focus();
  return true;
}

/** Moves the current line (or selected lines) down by one position in source mode. */
export function handleMoveLineDown(view: EditorView): boolean {
  return moveLines(view, "down");
}

/** Duplicates the current line (or selected lines) below the original in source mode. */
export function handleDuplicateLine(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.doc.toString();
  const result = duplicateLines(text, from, to);

  // A plain paragraph line needs an explicit hard break between the copies, or
  // the duplicate renders as a continuation of the same line. Structural lines
  // duplicate as siblings and need nothing.
  const lineIndex = state.doc.lineAt(to).number - 1;
  if (duplicateNeedsHardBreak(text.split("\n"), lineIndex)) {
    const lines = result.newText.split("\n");
    // The marker goes at the end of the FIRST copy, inside any quote prefix.
    if (lines[lineIndex] !== undefined) lines[lineIndex] += "\\";
    result.newText = lines.join("\n");
  }

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

/** Deletes the current line (or selected lines) in source mode. */
export function handleDeleteLine(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = deleteLines(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newCursor },
  });
  view.focus();
  return true;
}

/** Joins the current line with the next line (or all selected lines) in source mode. */
export function handleJoinLines(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.doc.toString();

  // Decline rather than fuse two separate blocks — joining across a blank line
  // merges paragraphs, and joining two list items collapses them into one.
  const startLine = state.doc.lineAt(from).number - 1;
  const endLine = state.doc.lineAt(to).number - 1;
  if (joinWouldFuseBlocks(text.split("\n"), startLine, endLine)) return false;

  const result = joinLines(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

/** Sorts selected lines in ascending alphabetical order in source mode. */
export function handleSortLinesAsc(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = sortLinesAscending(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

/** Sorts selected lines in descending alphabetical order in source mode. */
export function handleSortLinesDesc(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = sortLinesDescending(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

/** Removes blank lines from the selected text in source mode. Requires a selection. */
export function handleRemoveBlankLines(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;

  if (from === to) {
    return false; // No selection
  }

  const selectedText = view.state.doc.sliceString(from, to);
  const transformed = removeBlankLines(selectedText);

  if (transformed === selectedText) {
    return true; // No change needed
  }

  view.dispatch({
    changes: { from, to, insert: transformed },
    selection: { anchor: from, head: from + transformed.length },
  });
  view.focus();
  return true;
}

// --- Text transformations ---

/** Applies a text case transformation function to the selected text in source mode. */
export function handleTransformCase(view: EditorView, transform: (text: string) => string): boolean {
  const { from, to } = view.state.selection.main;

  if (from === to) {
    return false; // No selection
  }

  const selectedText = view.state.doc.sliceString(from, to);
  const transformed = transform(selectedText);

  if (transformed === selectedText) {
    return true; // No change needed
  }

  view.dispatch({
    changes: { from, to, insert: transformed },
    selection: { anchor: from, head: from + transformed.length },
  });
  view.focus();
  return true;
}

// Re-export transform functions for use in the dispatcher switch
export { toUpperCase, toLowerCase, toTitleCase, toggleCase };
