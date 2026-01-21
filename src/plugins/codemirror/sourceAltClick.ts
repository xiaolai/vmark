/**
 * Alt+Click Cursor Management for Source Mode
 *
 * Handles adding and removing cursors via Alt+Click in CodeMirror 6.
 */

import { EditorView } from "@codemirror/view";
import { EditorSelection, SelectionRange } from "@codemirror/state";
import { getCodeFenceInfo } from "@/plugins/sourceContextDetection/codeFenceDetection";

/**
 * Check if a position is within any existing cursor range.
 * Returns the index of the matching range, or -1 if not found.
 */
function cursorIndexAtPosition(
  ranges: readonly SelectionRange[],
  pos: number
): number {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (range.from === range.to && range.from === pos) {
      return i;
    }
  }
  return -1;
}

/**
 * Check if position is within selection range (not just cursor).
 */
function positionInRanges(
  ranges: readonly SelectionRange[],
  pos: number
): number {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (range.from === range.to) {
      if (pos === range.from) return i;
    } else if (pos >= range.from && pos < range.to) {
      return i;
    }
  }
  return -1;
}

/**
 * Get code block bounds if cursor is inside one.
 * Returns null if not in a code block.
 */
function getCodeBlockBounds(view: EditorView): { from: number; to: number } | null {
  const info = getCodeFenceInfo(view);
  if (!info) return null;
  // Calculate end position from endLine
  const endLine = view.state.doc.line(info.endLine);
  return { from: info.fenceStartPos, to: endLine.to };
}

/**
 * Check if the new position is valid given block boundary constraints.
 * If primary cursor is in a code block, new cursor must be in the same block.
 */
function isValidPosition(view: EditorView, pos: number): boolean {
  const bounds = getCodeBlockBounds(view);

  if (bounds) {
    // Primary is in code block - new cursor must be in same block
    return pos >= bounds.from && pos <= bounds.to;
  }

  // Primary is not in code block - check if new pos is in a code block
  // For simplicity, we allow it (different blocks can have different cursors)
  // The block boundary check is mainly for preventing cross-editing
  return true;
}

/**
 * Add a cursor at the specified position.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Position to add cursor
 * @returns true if cursor was added
 */
export function addCursorAtPosition(view: EditorView, pos: number): boolean {
  const { state } = view;
  const { selection, doc } = state;

  // Validate position
  if (pos < 0 || pos > doc.length) {
    return false;
  }

  // Check block boundaries
  if (!isValidPosition(view, pos)) {
    return false;
  }

  const ranges = selection.ranges;

  // Check if position already has a cursor
  const existingIndex = cursorIndexAtPosition(ranges, pos);
  if (existingIndex >= 0) {
    // Already has cursor at this position - make it primary
    if (existingIndex === selection.mainIndex) {
      return false; // Already primary
    }
    view.dispatch({
      selection: EditorSelection.create(ranges, existingIndex),
    });
    return true;
  }

  // Add new cursor
  const newRange = EditorSelection.cursor(pos);
  const newRanges = [...ranges, newRange];

  // Sort ranges by position and set new cursor as primary
  const sorted = newRanges
    .map((r, i) => ({ range: r, originalIndex: i }))
    .sort((a, b) => a.range.from - b.range.from);

  const newPrimaryIndex = sorted.findIndex((s) => s.originalIndex === newRanges.length - 1);

  view.dispatch({
    selection: EditorSelection.create(
      sorted.map((s) => s.range),
      newPrimaryIndex
    ),
  });

  return true;
}

/**
 * Remove cursor at the specified position.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Position to remove cursor
 * @returns true if cursor was removed
 */
export function removeCursorAtPosition(view: EditorView, pos: number): boolean {
  const { state } = view;
  const { selection } = state;

  if (selection.ranges.length <= 1) {
    return false; // Can't remove the only cursor
  }

  const indexToRemove = positionInRanges(selection.ranges, pos);
  if (indexToRemove < 0) {
    return false;
  }

  const newRanges = selection.ranges.filter((_, i) => i !== indexToRemove);

  // Adjust primary index
  let newMainIndex = selection.mainIndex;
  if (indexToRemove < selection.mainIndex) {
    newMainIndex--;
  } else if (indexToRemove === selection.mainIndex) {
    newMainIndex = 0;
  }

  // Ensure index is valid
  newMainIndex = Math.min(newMainIndex, newRanges.length - 1);

  view.dispatch({
    selection: EditorSelection.create(newRanges, newMainIndex),
  });

  return true;
}

/**
 * Toggle cursor at position (add if not present, remove if present).
 *
 * @param view - CodeMirror EditorView
 * @param pos - Position to toggle cursor
 * @returns true if an action was performed
 */
export function toggleCursorAtPosition(view: EditorView, pos: number): boolean {
  const { selection } = view.state;
  const existingIndex = positionInRanges(selection.ranges, pos);

  if (existingIndex >= 0 && selection.ranges.length > 1) {
    return removeCursorAtPosition(view, pos);
  }

  return addCursorAtPosition(view, pos);
}

/**
 * Handle Alt+Click event.
 *
 * @param view - CodeMirror EditorView
 * @param event - Mouse event
 * @returns true if event was handled
 */
export function handleAltClick(view: EditorView, event: MouseEvent): boolean {
  if (!event.altKey) {
    return false;
  }

  // Don't handle if other modifiers are pressed
  if (event.ctrlKey || event.metaKey) {
    return false;
  }

  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) {
    return false;
  }

  // Toggle cursor at click position
  const handled = toggleCursorAtPosition(view, pos);

  if (handled) {
    event.preventDefault();
    view.focus();
  }

  return handled;
}
