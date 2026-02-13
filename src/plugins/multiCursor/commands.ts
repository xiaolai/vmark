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
import type { EditorView } from "@tiptap/pm/view";
import { MultiSelection } from "./MultiSelection";
import { normalizeRangesWithPrimary } from "./rangeUtils";
import { filterRangesToBounds, getCodeBlockBounds } from "./codeBlockBounds";
import { findAllOccurrences, getSelectionText, getWordAtCursor } from "./textSearch";
import { multiCursorPluginKey } from "./multiCursorPlugin";

/** Fallback line height (px) when coordsAtPos returns zero-height rect */
const DEFAULT_LINE_HEIGHT_PX = 20;

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
 * Find the next unused occurrence after a given position, wrapping around.
 * Returns the first occurrence not already in `existingRanges`.
 */
function findNextUnusedOccurrence(
  occurrences: Array<{ from: number; to: number }>,
  afterPos: number,
  beforePos: number,
  existingRanges: readonly SelectionRange[]
): { from: number; to: number } | null {
  // Look after the given position
  for (const occ of occurrences) {
    if (occ.from > afterPos && !rangeExists(existingRanges, occ.from, occ.to)) {
      return occ;
    }
  }
  // Wrap around: look before the given position
  for (const occ of occurrences) {
    if (occ.from < beforePos && !rangeExists(existingRanges, occ.from, occ.to)) {
      return occ;
    }
  }
  return null;
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
  let bounds: { from: number; to: number } | null = null;

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

  if (occurrences.length === 0) return null;

  // Create ranges for all occurrences
  const ranges = occurrences.map((occ) => {
    const $from = state.doc.resolve(occ.from);
    const $to = state.doc.resolve(occ.to);
    return new SelectionRange($from, $to);
  });
  const filteredRanges = bounds ? filterRangesToBounds(ranges, bounds) : ranges;
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

  // Use afterPos - 1 so findNextUnusedOccurrence's `> afterPos` becomes `>= primaryRange.$to.pos`
  const nextOcc = findNextUnusedOccurrence(
    occurrences, primaryRange.$to.pos - 1, primaryRange.$from.pos, remaining
  );

  if (nextOcc) {
    // Add the new occurrence as primary
    const $from = state.doc.resolve(nextOcc.from);
    const $to = state.doc.resolve(nextOcc.to);
    const newRanges = [...remaining, new SelectionRange($from, $to)];
    const normalized = normalizeRangesWithPrimary(
      newRanges,
      state.doc,
      newRanges.length - 1
    );
    return state.tr.setSelection(
      new MultiSelection(normalized.ranges, normalized.primaryIndex)
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

/**
 * Soft undo: revert to the previous selection state before the last Cmd+D.
 * Pops the most recent entry from the selection history stack.
 *
 * @param state - Current editor state
 * @returns Transaction or null if no history
 */
export function softUndoCursor(state: EditorState): Transaction | null {
  if (!(state.selection instanceof MultiSelection)) return null;

  const pluginState = multiCursorPluginKey.getState(state);
  if (!pluginState || pluginState.selectionHistory.length === 0) return null;

  const newHistory = pluginState.selectionHistory.slice(0, -1);
  const snapshot = pluginState.selectionHistory[pluginState.selectionHistory.length - 1];

  // Restore the snapshot selection
  const ranges = snapshot.ranges.map((r) => {
    const $from = state.doc.resolve(r.from);
    const $to = state.doc.resolve(r.to);
    return new SelectionRange($from, $to);
  });

  let sel;
  if (ranges.length === 1) {
    sel = TextSelection.create(
      state.doc,
      ranges[0].$from.pos,
      ranges[0].$to.pos
    );
  } else {
    sel = new MultiSelection(ranges, snapshot.primaryIndex);
  }

  return state.tr
    .setSelection(sel)
    .setMeta(multiCursorPluginKey, { popHistory: newHistory });
}

/**
 * Add a cursor one line above the topmost cursor position.
 * Uses view.coordsAtPos/posAtCoords for accurate vertical placement.
 *
 * @param state - Current editor state
 * @param view - Editor view (needed for coordinate mapping)
 * @returns Transaction or null if no position above
 */
export function addCursorAbove(
  state: EditorState,
  view: EditorView
): Transaction | null {
  return addCursorVertical(state, view, -1);
}

/**
 * Add a cursor one line below the bottommost cursor position.
 * Uses view.coordsAtPos/posAtCoords for accurate vertical placement.
 *
 * @param state - Current editor state
 * @param view - Editor view (needed for coordinate mapping)
 * @returns Transaction or null if no position below
 */
export function addCursorBelow(
  state: EditorState,
  view: EditorView
): Transaction | null {
  return addCursorVertical(state, view, 1);
}

/**
 * Internal: add a cursor vertically (above or below) the extreme cursor.
 */
function addCursorVertical(
  state: EditorState,
  view: EditorView,
  direction: -1 | 1
): Transaction | null {
  const { selection } = state;

  // Collect existing cursor positions
  let existingRanges: SelectionRange[];

  if (selection instanceof MultiSelection) {
    existingRanges = [...selection.ranges];
  } else {
    const $from = state.doc.resolve(selection.from);
    const $to = state.doc.resolve(selection.to);
    existingRanges = [new SelectionRange($from, $to)];
  }

  // Find the extreme range (topmost for above, bottommost for below)
  const extremeRange =
    direction === -1
      ? existingRanges.reduce((min, r) =>
          r.$from.pos < min.$from.pos ? r : min
        )
      : existingRanges.reduce((max, r) =>
          r.$from.pos > max.$from.pos ? r : max
        );

  const pos = extremeRange.$from.pos;
  const coords = view.coordsAtPos(pos);

  // Offset by one line in the desired direction
  const lineHeight = coords.bottom - coords.top || DEFAULT_LINE_HEIGHT_PX;
  const targetY =
    direction === -1
      ? coords.top - lineHeight / 2
      : coords.bottom + lineHeight / 2;

  const result = view.posAtCoords({ left: coords.left, top: targetY });
  if (!result) return null;

  const newPos = result.pos;

  // Check if we actually moved to a different position
  if (newPos === pos) return null;

  // Check we're not duplicating an existing cursor
  if (rangeExists(existingRanges, newPos, newPos)) return null;

  const $newPos = state.doc.resolve(newPos);
  const newRange = new SelectionRange($newPos, $newPos);
  const newRanges = [...existingRanges, newRange];

  const normalized = normalizeRangesWithPrimary(
    newRanges,
    state.doc,
    newRanges.length - 1
  );
  return state.tr.setSelection(
    new MultiSelection(normalized.ranges, normalized.primaryIndex)
  );
}
