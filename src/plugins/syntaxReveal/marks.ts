/**
 * Syntax Reveal Plugin - Mark-based Syntax
 *
 * Handles inline marks: bold, italic, code, strikethrough, link
 */

import type { Decoration } from "@milkdown/kit/prose/view";
import type { Node, Mark, ResolvedPos } from "@milkdown/kit/prose/model";
import { addWidgetDecoration } from "./utils";

// Mark type to syntax mapping
const MARK_SYNTAX: Record<string, { open: string; close: string }> = {
  strong: { open: "**", close: "**" },
  emphasis: { open: "*", close: "*" },
  inlineCode: { open: "`", close: "`" },
  strikethrough: { open: "~~", close: "~~" },
  subscript: { open: "~", close: "~" },
  superscript: { open: "^", close: "^" },
  highlight: { open: "==", close: "==" },
};

const LINK_MARK = "link";

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

// Intl.Segmenter type declaration (ES2022)
interface SegmentData {
  segment: string;
  index: number;
  isWordLike?: boolean;
}

type SegmenterType = { segment: (text: string) => Iterable<SegmentData> };

// Cached segmenter instance (created once, reused)
let cachedSegmenter: SegmenterType | null = null;

/**
 * Get or create a cached Intl.Segmenter instance.
 * Returns null if Intl.Segmenter is not available.
 */
function getWordSegmenter(): SegmenterType | null {
  if (cachedSegmenter) return cachedSegmenter;

  // Feature detection for Intl.Segmenter
  if (!("Segmenter" in Intl)) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Segmenter = (Intl as any).Segmenter as new (
    locale?: string,
    options?: { granularity: string }
  ) => SegmenterType;

  cachedSegmenter = new Segmenter(undefined, { granularity: "word" });
  return cachedSegmenter;
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

  const segmenter = getWordSegmenter();
  if (!segmenter) return null;

  const text = parent.textContent;
  const offset = $pos.parentOffset;
  const blockStart = $pos.start();

  const segments = Array.from(segmenter.segment(text));

  // Find segment containing cursor
  for (const segment of segments) {
    const segStart = segment.index;
    const segEnd = segStart + segment.segment.length;

    // Cursor must be strictly inside word (not at either boundary)
    // This ensures "|text" and "text|" show INSERT, not FORMAT
    if (offset > segStart && offset < segEnd) {
      // Skip non-word segments (punctuation, whitespace)
      if (!segment.isWordLike) return null;

      return {
        from: blockStart + segStart,
        to: blockStart + segEnd,
      };
    }
  }
  return null;
}

/**
 * Find all mark ranges that contain the given position
 */
function findMarksAtPosition(pos: number, $pos: ResolvedPos): MarkRange[] {
  const ranges: MarkRange[] = [];
  const parent = $pos.parent;
  const parentStart = $pos.start();

  parent.forEach((child, childOffset) => {
    const from = parentStart + childOffset;
    const to = from + child.nodeSize;

    if (pos >= from && pos <= to && child.isText) {
      child.marks.forEach((mark) => {
        const markRange = findMarkRange(pos, mark, parentStart, parent);
        if (markRange) {
          if (!ranges.some((r) => r.from === markRange.from && r.to === markRange.to)) {
            ranges.push(markRange);
          }
        }
      });
    }
  });

  return ranges;
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

/**
 * Add mark-based syntax decorations
 */
export function addMarkSyntaxDecorations(
  decorations: Decoration[],
  pos: number,
  $from: ResolvedPos
): void {
  const markRanges = findMarksAtPosition(pos, $from);

  for (const { mark, from, to } of markRanges) {
    const syntax = MARK_SYNTAX[mark.type.name];

    if (syntax) {
      addWidgetDecoration(decorations, from, syntax.open, "open", -1);
      addWidgetDecoration(decorations, to, syntax.close, "close", 1);
    } else if (mark.type.name === LINK_MARK) {
      const href = mark.attrs.href || "";
      addWidgetDecoration(decorations, from, "[", "link-open", -1);
      addWidgetDecoration(decorations, to, `](${href})`, "link-close", 1);
    }
  }
}
