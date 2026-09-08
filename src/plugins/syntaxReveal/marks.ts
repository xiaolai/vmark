/**
 * Syntax Reveal — mark-range helpers
 *
 * Range and word lookups over inline marks (bold, italic, code, strikethrough,
 * link…) for the toolbar adapters and the expanded mark toggles. The decoration
 * half that once lived beside them — syntax widgets rendered at mark
 * boundaries — was never registered as an extension and was deleted under the
 * feature-ledger plan (WI-FL3.1); only these helpers were ever wired.
 */

import type { Node, Mark, ResolvedPos } from "@tiptap/pm/model";
import { findWordBoundaries } from "@/utils/wordSegmentation";

export interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/**
 * Find the range of any mark at the cursor position.
 * Used as fallback when the target mark doesn't exist but other marks do
 * (e.g., applying bold to linked text).
 * Returns the smallest range among all marks at cursor, with isLink flag.
 */
export function findAnyMarkRangeAtCursor(
  pos: number,
  $pos: ResolvedPos
): { from: number; to: number; isLink: boolean } | null {
  const parent = $pos.parent;
  const parentStart = $pos.start();
  let smallestRange: { from: number; to: number; isLink: boolean } | null = null;

  parent.forEach((child, childOffset) => {
    const from = parentStart + childOffset;
    const to = from + child.nodeSize;

    // Check if cursor is in this text node
    if (pos >= from && pos <= to && child.isText && child.marks.length > 0) {
      // Find ranges for each mark and pick the smallest
      for (const mark of child.marks) {
        const markRange = findMarkRange(pos, mark, parentStart, parent);
        /* v8 ignore next -- @preserve defensive guard: markRange is always found when pos is in a marked child */
        if (markRange) {
          const rangeSize = markRange.to - markRange.from;
          if (!smallestRange || rangeSize < (smallestRange.to - smallestRange.from)) {
            smallestRange = {
              from: markRange.from,
              to: markRange.to,
              isLink: mark.type.name === "link",
            };
          }
        }
      }
    }
  });

  return smallestRange;
}

/**
 * Find the word at cursor position using Intl.Segmenter.
 * Matches browser-native word selection behavior (double-click).
 * Returns null if cursor is in whitespace/punctuation or Segmenter unavailable.
 */
export function findWordAtCursor(
  $pos: ResolvedPos
): { from: number; to: number } | null {
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  const text = parent.textContent;
  const offset = $pos.parentOffset;
  const blockStart = $pos.start();

  const boundaries = findWordBoundaries(text, offset);
  if (!boundaries) return null;

  return {
    from: blockStart + boundaries.start,
    to: blockStart + boundaries.end,
  };
}

/**
 * Find the contiguous range of a mark containing the cursor position.
 * Non-greedy: returns only the smallest contiguous range that contains pos.
 */
export function findMarkRange(
  pos: number,
  mark: Mark,
  parentStart: number,
  parent: Node
): MarkRange | null {
  let currentFrom = -1;
  let currentTo = -1;
  let foundRange: MarkRange | null = null;

  parent.forEach((child, childOffset) => {
    // If we already found a range containing pos, skip remaining children
    if (foundRange) return;

    const childFrom = parentStart + childOffset;
    const childTo = childFrom + child.nodeSize;

    if (child.isText && mark.isInSet(child.marks)) {
      // Extend current range
      /* v8 ignore next -- @preserve reason: multi-node mark continuation not exercised in tests */
      if (currentFrom === -1) {
        currentFrom = childFrom;
      }
      currentTo = childTo;
    } else {
      // Gap in mark - check if cursor was in the accumulated range
      if (currentFrom !== -1 && currentTo !== -1) {
        if (pos >= currentFrom && pos <= currentTo) {
          foundRange = { mark, from: currentFrom, to: currentTo };
        }
      }
      // Reset for next potential range
      currentFrom = -1;
      currentTo = -1;
    }
  });

  // Check final accumulated range (if no gap at end)
  if (!foundRange && currentFrom !== -1 && currentTo !== -1) {
    if (pos >= currentFrom && pos <= currentTo) {
      foundRange = { mark, from: currentFrom, to: currentTo };
    }
  }

  return foundRange;
}
