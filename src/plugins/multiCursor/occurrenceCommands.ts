/**
 * Occurrence-based multi-cursor commands for ProseMirror.
 *
 * Commands that match text occurrences of the current selection or word:
 * - selectNextOccurrence: Add next match (Cmd+D)
 * - selectAllOccurrences: Select all matches (Cmd+Shift+L)
 * - skipOccurrence: Skip current match, take the next (Cmd+Shift+D)
 *
 * Extracted from commands.ts, which remains the stable entry point.
 */
import { TextSelection, SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { MultiSelection } from "./MultiSelection";
import { normalizeRangesWithPrimary } from "./rangeUtils";
import { filterRangesToBounds, getCodeBlockBounds } from "./codeBlockBounds";
import { findAllOccurrences, getSelectionText, getWordAtCursor } from "./textSearch";
import { multiCursorPluginKey } from "./multiCursorPlugin";
import {
  findNextUnusedOccurrence,
  selectionWithAddedPrimaryRange,
} from "./commandHelpers";

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
  let bounds: { from: number; to: number } | null;

  // Get current ranges (may be MultiSelection or regular selection)
  const existingRanges: SelectionRange[] = [];

  if (selection instanceof MultiSelection) {
    // Use primary selection's text
    const primary = selection.ranges[selection.primaryIndex];
    currentFrom = primary.$from.pos;
    currentTo = primary.$to.pos;
    searchText = state.doc.textBetween(currentFrom, currentTo);
    bounds = getCodeBlockBounds(state, currentFrom);
    if (bounds) {
      existingRanges.push(...filterRangesToBounds(selection.ranges, bounds));
    } else {
      existingRanges.push(...selection.ranges);
    }
  } else {
    currentFrom = selection.from;
    currentTo = selection.to;
    bounds = getCodeBlockBounds(state, currentFrom);

    if (currentFrom === currentTo) {
      // Empty selection - get word under cursor
      const word = getWordAtCursor(state);
      if (!word) return null;

      searchText = word.text;
      currentFrom = word.from;
      currentTo = word.to;
      if (bounds && (word.from < bounds.from || word.to > bounds.to)) {
        return null;
      }
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
  const occurrences = findAllOccurrences(state, searchText, bounds ?? undefined);

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
  const nextOccurrence = findNextUnusedOccurrence(
    occurrences, currentTo, currentFrom, existingRanges
  );
  if (!nextOccurrence) return null;

  // Create new MultiSelection with added range as primary
  const newSel = selectionWithAddedPrimaryRange(
    state.doc,
    existingRanges,
    nextOccurrence
  );

  return state.tr
    .setSelection(newSel)
    .setMeta(multiCursorPluginKey, { pushHistory: true });
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
  const bounds = getCodeBlockBounds(state, selection.from);

  if (selection.from === selection.to) {
    // Empty selection - get word under cursor
    const word = getWordAtCursor(state);
    if (!word) return null;

    if (bounds && (word.from < bounds.from || word.to > bounds.to)) {
      return null;
    }

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
  const occurrences = findAllOccurrences(state, searchText, bounds ?? undefined);

  // Reachable: a selection spanning multiple text nodes (block boundary or
  // mark boundary) yields non-empty searchText with no node-local match.
  if (occurrences.length === 0) return null;

  // Create ranges for all occurrences
  const ranges = occurrences.map((occ) => {
    const $from = state.doc.resolve(occ.from);
    const $to = state.doc.resolve(occ.to);
    return new SelectionRange($from, $to);
  });
  const filteredRanges = bounds ? filterRangesToBounds(ranges, bounds) : ranges;
  /* v8 ignore next -- @preserve defensive guard: occurrences are found within bounds, filtering cannot remove all */
  if (filteredRanges.length === 0) return null;

  // Find which occurrence contains the original selection to set as primary
  let primaryIndex = 0;
  for (let i = 0; i < filteredRanges.length; i++) {
    if (
      filteredRanges[i].$from.pos === initialFrom &&
      filteredRanges[i].$to.pos === initialTo
    ) {
      primaryIndex = i;
      break;
    }
  }

  if (filteredRanges.length === 1) {
    // Single occurrence - use TextSelection
    return state.tr.setSelection(
      TextSelection.create(state.doc, filteredRanges[0].$from.pos, filteredRanges[0].$to.pos)
    );
  }

  const newSel = new MultiSelection(filteredRanges, primaryIndex);
  return state.tr.setSelection(newSel);
}

/**
 * Skip the most-recently-added occurrence and find the next match.
 * Removes the primary (last-added) range and looks for the next occurrence
 * after that position, wrapping around if needed.
 *
 * @param state - Current editor state
 * @returns Transaction or null if not applicable
 */
export function skipOccurrence(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof MultiSelection)) return null;
  if (selection.ranges.length < 2) return null;

  const primaryRange = selection.ranges[selection.primaryIndex];
  const searchText = state.doc.textBetween(
    primaryRange.$from.pos,
    primaryRange.$to.pos
  );
  if (!searchText) return null;

  const bounds = getCodeBlockBounds(state, primaryRange.$from.pos);

  // Remove the primary range
  const remaining = selection.ranges.filter(
    (_r, i) => i !== selection.primaryIndex
  );

  // Find all occurrences and look for the next one after the removed range
  const occurrences = findAllOccurrences(state, searchText, bounds ?? undefined);

  // Find next unused occurrence after the skipped primary range
  const nextOcc = findNextUnusedOccurrence(
    occurrences, primaryRange.$to.pos, primaryRange.$from.pos, remaining
  );

  if (nextOcc) {
    // Add the new occurrence as primary
    return state.tr.setSelection(
      selectionWithAddedPrimaryRange(state.doc, remaining, nextOcc)
    );
  }

  // No new match found — just remove the primary range
  if (remaining.length === 1) {
    return state.tr.setSelection(
      TextSelection.create(
        state.doc,
        remaining[0].$from.pos,
        remaining[0].$to.pos
      )
    );
  }
  const normalized = normalizeRangesWithPrimary(
    remaining,
    state.doc,
    remaining.length - 1
  );
  return state.tr.setSelection(
    new MultiSelection(normalized.ranges, normalized.primaryIndex)
  );
}
