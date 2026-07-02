/**
 * Shared helpers for multi-cursor commands.
 *
 * Range-membership, next-occurrence lookup, and selection-building logic
 * used by both the occurrence commands (occurrenceCommands.ts) and the
 * cursor commands (cursorCommands.ts). Extracted from commands.ts.
 */
import { SelectionRange } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import { MultiSelection } from "./MultiSelection";
import { normalizeRangesWithPrimary } from "./rangeUtils";

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
 * Check if a position falls within any existing range (boundaries inclusive).
 * Covers both exact collapsed-cursor duplicates and positions inside a
 * non-empty selection range — a new collapsed cursor must not land in either.
 */
export function positionWithinRanges(
  ranges: readonly SelectionRange[],
  pos: number
): boolean {
  return ranges.some((r) => r.$from.pos <= pos && pos <= r.$to.pos);
}

/**
 * Find the next unused occurrence after a given position, wrapping around.
 * Returns the first occurrence not already in `existingRanges`.
 */
export function findNextUnusedOccurrence(
  occurrences: Array<{ from: number; to: number }>,
  afterPos: number,
  beforePos: number,
  existingRanges: readonly SelectionRange[]
): { from: number; to: number } | null {
  // Look after the given position
  for (const occ of occurrences) {
    if (occ.from >= afterPos && !rangeExists(existingRanges, occ.from, occ.to)) {
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
 * Build a MultiSelection from the existing ranges plus one new range, with
 * the new range as primary (normalization re-sorts; the primary index
 * follows the added range).
 */
export function selectionWithAddedPrimaryRange(
  doc: Node,
  existingRanges: readonly SelectionRange[],
  range: { from: number; to: number }
): MultiSelection {
  const $from = doc.resolve(range.from);
  const $to = doc.resolve(range.to);
  const newRanges = [...existingRanges, new SelectionRange($from, $to)];
  const normalized = normalizeRangesWithPrimary(
    newRanges,
    doc,
    newRanges.length - 1
  );
  return new MultiSelection(normalized.ranges, normalized.primaryIndex);
}
