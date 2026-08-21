/**
 * Formattable Segment Extraction and Reconstruction
 *
 * Purpose: Splits markdown text into formattable segments (the gaps between
 * protected regions) and reassembles the document after the segments have
 * been formatted. Split out of markdownParser.ts, which owns protected-region
 * detection.
 *
 * Invariant: `protectedRegions` must be sorted by start and non-overlapping,
 * exactly as returned by `findProtectedRegions` (which coalesces overlapping
 * or contained regions). Overlapping regions would make reconstruction emit
 * the overlapped range twice.
 *
 * @coordinates-with markdownParser.ts — findProtectedRegions produces the regions
 * @coordinates-with formatter.ts — calls extract before and reconstruct after formatting
 * @module lib/cjkFormatter/segments
 */

import type { ProtectedRegion } from "./types";

/**
 * A text segment that should be formatted (a non-protected region).
 *
 * The two edge flags exist because the line-anchored rules — `removeTrailingSpaces`
 * (`/ +$/gm`) and `collapseSpaces` — run on a segment, not on the document, and
 * a segment boundary is NOT a line boundary. Without them, the space in
 * `使用 \`printf\` 函数` sat at the end of the segment `使用 ` and was deleted as
 * end-of-line trailing whitespace: a CJK/Latin spacer deleting CJK/Latin
 * spacing, on every inline code span, image, wiki link, footnote reference,
 * inline math span and HTML tag in the document (WI-CJKF2.1).
 */
export interface TextSegment {
  start: number;
  end: number;
  text: string;
  /** The character BEFORE `start` is a line break, or `start` is offset 0. */
  startsAtLineStart: boolean;
  /**
   * The character AT `end` is a line break, or `end` is the end of the text.
   *
   * Note it describes what FOLLOWS the segment, not its last character: a
   * segment that swallows the newline and stops at a fence reports `false`.
   * That is harmless — the rule consults this only for the segment's LAST
   * line, which in that case is empty.
   */
  endsAtLineEnd: boolean;
}

/** Any ECMAScript line terminator, so CRLF documents behave like LF ones. */
const isLineBreak = (ch: string | undefined): boolean => ch !== undefined && /[\n\r]/.test(ch);

/**
 * Extract text segments that should be formatted (non-protected regions).
 *
 * Each segment reports whether its edges coincide with real line edges of the
 * FULL text, which the rules cannot otherwise know — see `TextSegment`.
 */
export function extractFormattableSegments(
  text: string,
  protectedRegions: ProtectedRegion[]
): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentPos = 0;

  const push = (start: number, end: number): void => {
    segments.push({
      start,
      end,
      text: text.slice(start, end),
      startsAtLineStart: start === 0 || isLineBreak(text[start - 1]),
      endsAtLineEnd: end >= text.length || isLineBreak(text[end]),
    });
  };

  for (const region of protectedRegions) {
    if (region.start > currentPos) push(currentPos, region.start);
    currentPos = region.end;
  }

  // Add remaining text after last protected region
  if (currentPos < text.length) push(currentPos, text.length);

  return segments;
}

/**
 * Reconstruct the full text after formatting segments.
 */
export function reconstructText(
  originalText: string,
  formattedSegments: TextSegment[],
  protectedRegions: ProtectedRegion[]
): string {
  const parts: { start: number; text: string }[] = [];

  // Add protected regions
  for (const region of protectedRegions) {
    parts.push({
      start: region.start,
      text: originalText.slice(region.start, region.end),
    });
  }

  // Add formatted segments
  for (const segment of formattedSegments) {
    parts.push({
      start: segment.start,
      text: segment.text,
    });
  }

  // Sort by original position and join
  parts.sort((a, b) => a.start - b.start);
  return parts.map((p) => p.text).join("");
}
