/**
 * Range utilities for multi-cursor
 *
 * Handles merging overlapping ranges and sorting/deduplication.
 */
import { SelectionRange } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";

/**
 * Sort ranges by their start position (ascending).
 */
function sortByPosition(ranges: SelectionRange[]): SelectionRange[] {
  return [...ranges].sort((a, b) => a.$from.pos - b.$from.pos);
}

/**
 * Check if two ranges overlap (boundary-touching does not count).
 */
function rangesOverlap(a: SelectionRange, b: SelectionRange): boolean {
  // Treat identical empty ranges as overlap to dedupe cursors
  if (a.$from.pos === a.$to.pos && b.$from.pos === b.$to.pos) {
    return a.$from.pos === b.$from.pos;
  }
  // a ends after b starts (touching at boundary is not overlap)
  return a.$to.pos > b.$from.pos;
}

/**
 * Merge two overlapping/adjacent ranges.
 */
function mergeTwo(a: SelectionRange, b: SelectionRange, doc: Node): SelectionRange {
  const from = Math.min(a.$from.pos, b.$from.pos);
  const to = Math.max(a.$to.pos, b.$to.pos);
  return new SelectionRange(doc.resolve(from), doc.resolve(to));
}

/**
 * Merge overlapping ranges.
 * Returns a new array with merged ranges.
 *
 * @param ranges - Ranges to merge
 * @param doc - Document for resolving positions
 * @returns Merged ranges
 */
export function mergeOverlappingRanges(
  ranges: readonly SelectionRange[],
  doc: Node
): SelectionRange[] {
  if (ranges.length <= 1) {
    return [...ranges];
  }

  // Sort by position first
  const sorted = sortByPosition([...ranges]);
  const result: SelectionRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result[result.length - 1];

    if (rangesOverlap(last, current)) {
      // Merge with previous
      result[result.length - 1] = mergeTwo(last, current, doc);
    } else {
      // No overlap, add as separate
      result.push(current);
    }
  }

  return result;
}

/**
 * Sort ranges and remove duplicates (same position).
 *
 * @param ranges - Ranges to sort and dedupe
 * @param doc - Document for resolving positions
 * @returns Sorted, deduplicated ranges
 */
export function sortAndDedupeRanges(
  ranges: readonly SelectionRange[],
  _doc: Node
): SelectionRange[] {
  if (ranges.length <= 1) {
    return [...ranges];
  }

  const sorted = sortByPosition([...ranges]);
  const result: SelectionRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result[result.length - 1];

    // Skip if same position as previous
    if (
      current.$from.pos === last.$from.pos &&
      current.$to.pos === last.$to.pos
    ) {
      continue;
    }

    result.push(current);
  }

  return result;
}

/**
 * Normalize ranges after an operation.
 * Sorts, removes duplicates, and optionally merges overlapping ranges.
 *
 * @param ranges - Ranges to normalize
 * @param doc - Document for resolving positions
 * @param merge - Whether to merge overlapping ranges
 * @returns Normalized ranges
 */
export function normalizeRanges(
  ranges: readonly SelectionRange[],
  doc: Node,
  merge = false
): SelectionRange[] {
  if (merge) {
    return mergeOverlappingRanges(ranges, doc);
  }
  return sortAndDedupeRanges(ranges, doc);
}

/**
 * Normalize ranges and preserve the primary index.
 * Sorts ranges and removes duplicates, and optionally merges overlaps.
 *
 * @param ranges - Ranges to normalize
 * @param doc - Document for resolving positions
 * @param primaryIndex - Current primary range index
 * @param merge - Whether to merge overlapping ranges
 * @returns Normalized ranges and updated primary index
 */
export function normalizeRangesWithPrimary(
  ranges: readonly SelectionRange[],
  doc: Node,
  primaryIndex: number,
  merge = false
): { ranges: SelectionRange[]; primaryIndex: number } {
  if (ranges.length === 0) {
    return { ranges: [], primaryIndex: 0 };
  }

  const primary = ranges[Math.min(Math.max(primaryIndex, 0), ranges.length - 1)];
  const normalized = normalizeRanges(ranges, doc, merge);

  const primaryMatch = normalized.findIndex(
    (range) =>
      range.$from.pos === primary.$from.pos && range.$to.pos === primary.$to.pos
  );

  return {
    ranges: normalized,
    primaryIndex: primaryMatch >= 0 ? primaryMatch : 0,
  };
}
