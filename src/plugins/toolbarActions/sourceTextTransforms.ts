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
import { moveBlockAware } from "./sourceBlockMove";
import { joinWouldFuseBlocks, duplicateNeedsHardBreak } from "./sourceLineClassifier";
import { fenceRanges, isDelimiterLine } from "@/plugins/shared/lineContent";

// --- Line operations ---

/**
 * Line indices `[first, last]` covered by the main selection, honouring
 * CodeMirror's EXCLUSIVE `to`: a selection ending at a line's start merely
 * touches that line and must not include it. `lineAt(to)` read the NEXT line
 * in three handlers while the shared utils correctly excluded it — so a move
 * dragged an untouched line, duplicate classified the wrong line for its hard
 * break, and join refused valid operations.
 */
function selectedLineRange(view: EditorView): { first: number; last: number } {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;
  const lastOffset = to > from ? to - 1 : to;
  return {
    first: doc.lineAt(from).number - 1,
    last: doc.lineAt(lastOffset).number - 1,
  };
}

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
  const text = state.doc.toString();
  const lines = text.split("\n");
  const { first, last } = selectedLineRange(view);

  const moved = moveBlockAware(lines, { start: first, end: last }, direction);
  if (!moved) return false;

  const newText = moved.lines.join("\n");
  // The move reports where the selection landed. Searching the new text for the
  // moved lines warped the selection to the FIRST identical text in the file.
  const movedText = lines.slice(first, last + 1).join("\n");
  const anchor = moved.lines
    .slice(0, moved.selectionStart)
    .reduce((offset, line) => offset + line.length + 1, 0);

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

/**
 * Whether the selection touches a fence DELIMITER line.
 *
 * The line operations are on the code-block allow-list because they manipulate
 * literal text — which is true of fence CONTENT and false of the delimiters that
 * make it a fence.
 */
function touchesFenceDelimiter(view: EditorView): boolean {
  const lines = view.state.doc.toString().split("\n");
  const { first, last } = selectedLineRange(view);
  // Scanned once, not once per selected line.
  const fences = fenceRanges(lines);
  for (let i = first; i <= last; i += 1) {
    if (isDelimiterLine(fences, i)) return true;
  }
  return false;
}

/** Duplicates the current line (or selected lines) below the original in source mode. */
export function handleDuplicateLine(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.doc.toString();
  // Refuse a fence DELIMITER. Suppressing the hard-break marker was not enough:
  // duplicating an opener immediately closes the block, and duplicating a closer
  // opens a new one that swallows the rest of the file as code.
  if (touchesFenceDelimiter(view)) return false;
  const result = duplicateLines(text, from, to);

  // A plain paragraph line needs an explicit hard break between the copies, or
  // the duplicate renders as a continuation of the same line. Structural lines
  // duplicate as siblings and need nothing. The classified line must be the
  // LAST SELECTED one — the same exclusive-`to` rule `duplicateLines` itself
  // applies — or a selection ending at a line start classifies its neighbour.
  const lineIndex = selectedLineRange(view).last;
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
  // Deleting one delimiter leaves the other unbalanced, so the fence either
  // never closes or never opens.
  if (touchesFenceDelimiter(view)) return false;
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
  const { first, last } = selectedLineRange(view);
  if (joinWouldFuseBlocks(text.split("\n"), first, last)) return false;

  const result = joinLines(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

/**
 * Sort the selected lines. Refuses a selection touching a fence DELIMITER —
 * sorting an opener into its own content destroys the fence and exposes the
 * rest of the file as code. Content-only sorting inside a fence stays allowed;
 * literal-line semantics are why sort is on the code-block allow-list at all.
 */
function handleSortLines(
  view: EditorView,
  sorter: (text: string, from: number, to: number) => { newText: string; newFrom: number; newTo: number },
): boolean {
  if (touchesFenceDelimiter(view)) return false;
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = sorter(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

/** Sorts selected lines in ascending alphabetical order in source mode. */
export function handleSortLinesAsc(view: EditorView): boolean {
  return handleSortLines(view, sortLinesAscending);
}

/** Sorts selected lines in descending alphabetical order in source mode. */
export function handleSortLinesDesc(view: EditorView): boolean {
  return handleSortLines(view, sortLinesDescending);
}

/**
 * Replace the selection with `transform(selection)`, keeping the selection on
 * the result. The one implementation behind remove-blank-lines and every case
 * transform — the two used to be copy-paste twins.
 */
function applySelectedTextTransform(
  view: EditorView,
  transform: (text: string) => string,
): boolean {
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

/** Removes blank lines from the selected text in source mode. Requires a selection. */
export function handleRemoveBlankLines(view: EditorView): boolean {
  return applySelectedTextTransform(view, removeBlankLines);
}

// --- Text transformations ---

/** Applies a text case transformation function to the selected text in source mode. */
export function handleTransformCase(view: EditorView, transform: (text: string) => string): boolean {
  return applySelectedTextTransform(view, transform);
}

// Re-export transform functions for use in the dispatcher switch
export { toUpperCase, toLowerCase, toTitleCase, toggleCase };
