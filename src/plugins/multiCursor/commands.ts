/**
 * Multi-cursor commands for ProseMirror
 *
 * Commands for creating and managing multi-cursor selections:
 * - selectNextOccurrence: Add next match (Cmd+D)
 * - selectAllOccurrences: Select all matches (Cmd+Shift+L)
 * - collapseMultiSelection: Collapse to single cursor (Escape)
 */
import { TextSelection, SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { MultiSelection } from "./MultiSelection";
import { normalizeRangesWithPrimary } from "./rangeUtils";
import { findWordBoundaries } from "../../utils/wordSegmentation";

/**
 * Get the text content of a selection range.
 */
function getSelectionText(state: EditorState): string {
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to);
}

/**
 * Get word at cursor position when selection is empty.
 * Returns the word boundaries in document coordinates.
 */
function getWordAtCursor(
  state: EditorState
): { from: number; to: number; text: string } | null {
  const { from, to } = state.selection;

  // Only works for cursor (empty selection)
  if (from !== to) return null;

  // Get text content of the paragraph/block containing cursor
  const $pos = state.doc.resolve(from);
  const parent = $pos.parent;
  const parentOffset = $pos.parentOffset;

  const text = parent.textContent;
  const boundaries = findWordBoundaries(text, parentOffset);

  if (!boundaries) return null;

  // Convert to document coordinates
  const blockStart = from - parentOffset;
  return {
    from: blockStart + boundaries.start,
    to: blockStart + boundaries.end,
    text: text.slice(boundaries.start, boundaries.end),
  };
}

/**
 * Find all occurrences of searchText in the document.
 * Returns array of { from, to } positions.
 */
function findAllOccurrences(
  state: EditorState,
  searchText: string
): Array<{ from: number; to: number }> {
  const results: Array<{ from: number; to: number }> = [];

  if (!searchText) return results;

  state.doc.descendants((node, pos) => {
    if (!node.isText) return;

    const text = node.text || "";
    let index = text.indexOf(searchText);

    while (index !== -1) {
      results.push({
        from: pos + index,
        to: pos + index + searchText.length,
      });
      index = text.indexOf(searchText, index + 1);
    }
  });

  // Sort by position
  results.sort((a, b) => a.from - b.from);

  return results;
}

/**
 * Check if a range is already in the MultiSelection.
 */
function rangeExists(
  ranges: readonly SelectionRange[],
  from: number,
  to: number
): boolean {
  return ranges.some((r) => r.$from.pos === from && r.$to.pos === to);
}

/**
 * Select next occurrence of current selection or word under cursor.
 * Behavior:
 * - If selection empty: select word under cursor
 * - If selection non-empty: find and add next occurrence
 * - Wraps around once, stops if next match would duplicate
 *
 * @param state - Current editor state
 * @returns Transaction or null if no action
 */
export function selectNextOccurrence(state: EditorState): Transaction | null {
  const { selection } = state;
  let searchText: string;
  let currentFrom: number;
  let currentTo: number;
  let selectedFromEmpty = false;

  // Get current ranges (may be MultiSelection or regular selection)
  const existingRanges: SelectionRange[] = [];

  if (selection instanceof MultiSelection) {
    existingRanges.push(...selection.ranges);
    // Use primary selection's text
    const primary = selection.ranges[selection.primaryIndex];
    currentFrom = primary.$from.pos;
    currentTo = primary.$to.pos;
    searchText = state.doc.textBetween(currentFrom, currentTo);
  } else {
    currentFrom = selection.from;
    currentTo = selection.to;

    if (currentFrom === currentTo) {
      // Empty selection - get word under cursor
      const word = getWordAtCursor(state);
      if (!word) return null;

      searchText = word.text;
      currentFrom = word.from;
      currentTo = word.to;
      const $from = state.doc.resolve(word.from);
      const $to = state.doc.resolve(word.to);
      existingRanges.push(new SelectionRange($from, $to));
      selectedFromEmpty = true;
    } else {
      searchText = getSelectionText(state);
      const $from = state.doc.resolve(currentFrom);
      const $to = state.doc.resolve(currentTo);
      existingRanges.push(new SelectionRange($from, $to));
    }
  }

  if (!searchText) return null;

  // Find all occurrences
  const occurrences = findAllOccurrences(state, searchText);

  if (occurrences.length <= 1) {
    if (selectedFromEmpty && existingRanges.length === 1) {
      const normalized = normalizeRangesWithPrimary(
        existingRanges,
        state.doc,
        0
      );
      return state.tr.setSelection(
        new MultiSelection(normalized.ranges, normalized.primaryIndex)
      );
    }
    return null;
  }

  // Find next occurrence after current position (or wrap around)
  let nextOccurrence: { from: number; to: number } | null = null;

  // First, look for occurrences after current position
  for (const occ of occurrences) {
    if (occ.from > currentTo && !rangeExists(existingRanges, occ.from, occ.to)) {
      nextOccurrence = occ;
      break;
    }
  }

  // If not found, wrap around and look before current position
  if (!nextOccurrence) {
    for (const occ of occurrences) {
      if (occ.from < currentFrom && !rangeExists(existingRanges, occ.from, occ.to)) {
        nextOccurrence = occ;
        break;
      }
    }
  }

  if (!nextOccurrence) return null;

  // Create new MultiSelection with added range
  const $from = state.doc.resolve(nextOccurrence.from);
  const $to = state.doc.resolve(nextOccurrence.to);
  const newRange = new SelectionRange($from, $to);

  const newRanges = [...existingRanges, newRange];
  const normalized = normalizeRangesWithPrimary(
    newRanges,
    state.doc,
    newRanges.length - 1
  );
  const newSel = new MultiSelection(normalized.ranges, normalized.primaryIndex);

  return state.tr.setSelection(newSel);
}

/**
 * Select all occurrences of current selection or word under cursor.
 *
 * @param state - Current editor state
 * @returns Transaction or null if no action
 */
export function selectAllOccurrences(state: EditorState): Transaction | null {
  const { selection } = state;
  let searchText: string;
  let initialFrom: number;
  let initialTo: number;

  if (selection.from === selection.to) {
    // Empty selection - get word under cursor
    const word = getWordAtCursor(state);
    if (!word) return null;

    searchText = word.text;
    initialFrom = word.from;
    initialTo = word.to;
  } else {
    searchText = getSelectionText(state);
    initialFrom = selection.from;
    initialTo = selection.to;
  }

  if (!searchText) return null;

  // Find all occurrences
  const occurrences = findAllOccurrences(state, searchText);

  if (occurrences.length === 0) return null;

  // Create ranges for all occurrences
  const ranges = occurrences.map((occ) => {
    const $from = state.doc.resolve(occ.from);
    const $to = state.doc.resolve(occ.to);
    return new SelectionRange($from, $to);
  });

  // Find which occurrence contains the original selection to set as primary
  let primaryIndex = 0;
  for (let i = 0; i < occurrences.length; i++) {
    if (occurrences[i].from === initialFrom && occurrences[i].to === initialTo) {
      primaryIndex = i;
      break;
    }
  }

  if (ranges.length === 1) {
    // Single occurrence - use TextSelection
    return state.tr.setSelection(
      TextSelection.create(state.doc, ranges[0].$from.pos, ranges[0].$to.pos)
    );
  }

  const newSel = new MultiSelection(ranges, primaryIndex);
  return state.tr.setSelection(newSel);
}

/**
 * Collapse multi-selection to single cursor at primary position.
 *
 * @param state - Current editor state
 * @returns Transaction or null if not a MultiSelection
 */
export function collapseMultiSelection(state: EditorState): Transaction | null {
  const { selection } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const primary = selection.ranges[selection.primaryIndex];
  const newSel = TextSelection.create(
    state.doc,
    primary.$from.pos,
    primary.$to.pos
  );

  return state.tr.setSelection(newSel);
}
