/**
 * Alt+Click cursor management for multi-cursor
 *
 * Handles adding and removing cursors via Alt+Click.
 */
import { Selection, TextSelection, SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { MultiSelection } from "./MultiSelection";
import { normalizeRangesWithPrimary } from "./rangeUtils";

/**
 * Check if a position is within any existing range.
 */
function positionInRanges(
  ranges: readonly SelectionRange[],
  pos: number
): number {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const from = range.$from.pos;
    const to = range.$to.pos;
    if (from === to) {
      if (pos === from) return i;
    } else if (pos >= from && pos < to) {
      return i;
    }
  }
  return -1;
}

/**
 * Snap a position to the nearest valid text selection.
 * This avoids placing cursors inside atom nodes.
 */
function snapToTextSelection(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(pos);
  const nodeAfter = $pos.nodeAfter;
  const nodeBefore = $pos.nodeBefore;

  if ((nodeAfter && nodeAfter.isAtom) || (nodeBefore && nodeBefore.isAtom)) {
    const bias = nodeAfter ? 1 : -1;
    const near = Selection.near($pos, bias, true);
    return near.from;
  }

  if (!$pos.parent.isTextblock) {
    const near = Selection.near($pos, 1, true);
    return near.from;
  }

  return pos;
}

/**
 * Add a cursor at the specified position.
 * If the position is already occupied, sets it as primary.
 *
 * @param state - Current editor state
 * @param pos - Position to add cursor
 * @returns Transaction or null
 */
export function addCursorAtPosition(
  state: EditorState,
  pos: number
): Transaction | null {
  const { selection, doc } = state;

  // Validate position
  if (pos < 0 || pos > doc.content.size) {
    return null;
  }

  const snappedPos = snapToTextSelection(state, pos);
  const $pos = doc.resolve(snappedPos);
  const newRange = new SelectionRange($pos, $pos);

  if (selection instanceof MultiSelection) {
    // Check if position is already in existing ranges
    const existingIndex = positionInRanges(selection.ranges, pos);
    if (existingIndex >= 0) {
      // Position already has a cursor - set it as primary
      if (existingIndex === selection.primaryIndex) {
        return null; // Already primary
      }
      const newSel = new MultiSelection([...selection.ranges], existingIndex);
      return state.tr.setSelection(newSel);
    }

    // Add new cursor
    const newRanges = [...selection.ranges, newRange];
    const normalized = normalizeRangesWithPrimary(
      newRanges,
      doc,
      newRanges.length - 1
    );
    const newSel = new MultiSelection(normalized.ranges, normalized.primaryIndex);
    return state.tr.setSelection(newSel);
  }

  // Convert single selection to MultiSelection
  const existingRange = new SelectionRange(selection.$anchor, selection.$head);

  // Check if clicking on same position
  if (selection.from === snappedPos && selection.to === snappedPos) {
    return null;
  }

  const newRanges = [existingRange, newRange];
  const normalized = normalizeRangesWithPrimary(newRanges, doc, 1);
  const newSel = new MultiSelection(normalized.ranges, normalized.primaryIndex); // New cursor is primary
  return state.tr.setSelection(newSel);
}

/**
 * Remove cursor at the specified position.
 *
 * @param state - Current editor state
 * @param pos - Position to remove cursor
 * @returns Transaction or null
 */
export function removeCursorAtPosition(
  state: EditorState,
  pos: number
): Transaction | null {
  const { selection, doc } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  // Find cursor at position
  const indexToRemove = positionInRanges(selection.ranges, pos);
  if (indexToRemove < 0) {
    return null;
  }

  const newRanges = selection.ranges.filter((_, i) => i !== indexToRemove);

  if (newRanges.length === 0) {
    return null; // Can't remove all cursors
  }

  if (newRanges.length === 1) {
    // Collapse to single selection
    const remaining = newRanges[0];
    return state.tr.setSelection(
      TextSelection.create(doc, remaining.$from.pos, remaining.$to.pos)
    );
  }

  // Adjust primary index
  let newPrimaryIndex = selection.primaryIndex;
  if (indexToRemove < selection.primaryIndex) {
    newPrimaryIndex--;
  } else if (indexToRemove === selection.primaryIndex) {
    // Primary was removed, use first remaining cursor
    newPrimaryIndex = 0;
  }

  const newSel = new MultiSelection(newRanges, newPrimaryIndex);
  return state.tr.setSelection(newSel);
}

/**
 * Toggle cursor at position (add if not present, remove if present).
 *
 * @param state - Current editor state
 * @param pos - Position to toggle cursor
 * @returns Transaction or null
 */
export function toggleCursorAtPosition(
  state: EditorState,
  pos: number
): Transaction | null {
  const { selection } = state;

  if (selection instanceof MultiSelection) {
    const existingIndex = positionInRanges(selection.ranges, pos);
    if (existingIndex >= 0 && selection.ranges.length > 1) {
      return removeCursorAtPosition(state, pos);
    }
  }

  return addCursorAtPosition(state, pos);
}
