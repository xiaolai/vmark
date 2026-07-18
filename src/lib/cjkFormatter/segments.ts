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

import type { ProtectedRegion } from "./markdownParser";

/**
 * A text segment that should be formatted (a non-protected region).
 */
export interface TextSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Extract text segments that should be formatted (non-protected regions).
 * Returns array of { start, end, text } for regions to format.
 */
export function extractFormattableSegments(
  text: string,
  protectedRegions: ProtectedRegion[]
): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentPos = 0;

  for (const region of protectedRegions) {
    if (region.start > currentPos) {
      segments.push({
        start: currentPos,
        end: region.start,
        text: text.slice(currentPos, region.start),
      });
    }
    currentPos = region.end;
  }

  // Add remaining text after last protected region
  if (currentPos < text.length) {
    segments.push({
      start: currentPos,
      end: text.length,
      text: text.slice(currentPos),
    });
  }

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
