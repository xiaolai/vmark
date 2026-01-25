/**
 * Word Segmentation Utility
 *
 * Provides consistent word boundary detection across both WYSIWYG (Tiptap)
 * and Source (CodeMirror) editors using Intl.Segmenter API.
 *
 * This is a pure utility - no framework dependencies (React, Zustand, Tauri).
 * Falls back to regex-based detection when Intl.Segmenter is unavailable.
 */

// Intl.Segmenter type declaration (ES2022)
// Global augmentation for Intl.Segmenter which is not in older TS lib
declare global {
  namespace Intl {
    interface SegmentData {
      segment: string;
      index: number;
      isWordLike?: boolean;
    }

    interface Segments extends Iterable<SegmentData> {
      containing(index: number): SegmentData | undefined;
    }

    interface Segmenter {
      segment(input: string): Segments;
    }

    interface SegmenterOptions {
      localeMatcher?: "lookup" | "best fit";
      granularity?: "grapheme" | "word" | "sentence";
    }

    const Segmenter: {
      new (locale?: string | string[], options?: SegmenterOptions): Segmenter;
      prototype: Segmenter;
      supportedLocalesOf(
        locales: string | string[],
        options?: { localeMatcher?: "lookup" | "best fit" }
      ): string[];
    };
  }
}

type SegmenterType = { segment: (text: string) => Iterable<Intl.SegmentData> };

// Cached segmenter instance (created once, reused)
let cachedSegmenter: SegmenterType | null = null;
let segmenterChecked = false;

/**
 * Get or create a cached Intl.Segmenter instance.
 * Returns null if Intl.Segmenter is not available.
 */
function getWordSegmenter(): SegmenterType | null {
  if (segmenterChecked) return cachedSegmenter;

  segmenterChecked = true;

  // Feature detection for Intl.Segmenter
  if (!("Segmenter" in Intl)) return null;

  cachedSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  return cachedSegmenter;
}

/**
 * Find word boundaries at a given position in text.
 * Uses Intl.Segmenter for browser-native word segmentation with CJK support.
 * Falls back to regex for environments without Segmenter.
 *
 * @param text - Line or paragraph text to search within
 * @param posInText - Cursor position within text (0-based)
 * @returns Object with start/end offsets, or null if not in a word
 *
 * @example
 * findWordBoundaries("hello world", 2) // { start: 0, end: 5 }
 * findWordBoundaries("hello world", 5) // null (at space)
 * findWordBoundaries("你好世界", 1)    // { start: 0, end: 2 } (你好)
 */
export function findWordBoundaries(
  text: string,
  posInText: number
): { start: number; end: number } | null {
  // Edge case: empty text or invalid position
  if (!text || posInText < 0 || posInText > text.length) {
    return null;
  }

  const segmenter = getWordSegmenter();

  if (segmenter) {
    return findWordBoundariesWithSegmenter(text, posInText, segmenter);
  }

  // Fallback to regex-based detection
  return findWordBoundariesWithRegex(text, posInText);
}

type WordSegment = { start: number; end: number };

/**
 * Get all word-like segments in a text.
 */
export function getWordSegments(text: string): WordSegment[] {
  if (!text) return [];
  const segmenter = getWordSegmenter();

  if (segmenter) {
    const segments: WordSegment[] = [];
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue;
      segments.push({
        start: segment.index,
        end: segment.index + segment.segment.length,
      });
    }
    return segments;
  }

  return getWordSegmentsWithRegex(text);
}

/**
 * Find the next word edge relative to a position.
 * dir < 0 moves left to word starts; dir > 0 moves right to word ends.
 */
export function findWordEdge(
  text: string,
  posInText: number,
  dir: -1 | 1
): number | null {
  if (!text) return null;
  const segments = getWordSegments(text);
  if (!segments.length) return null;

  const pos = Math.max(0, Math.min(text.length, posInText));

  if (dir < 0) {
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (pos > seg.start && pos <= seg.end) {
        return seg.start;
      }
      if (pos <= seg.start) continue;
      if (pos > seg.end) {
        return seg.start;
      }
    }
    return segments[0].start;
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (pos >= seg.start && pos < seg.end) {
      return seg.end;
    }
    if (pos < seg.start) {
      return seg.end;
    }
  }
  return segments[segments.length - 1].end;
}

/**
 * Find word boundaries using Intl.Segmenter.
 * Provides accurate CJK word segmentation.
 */
function findWordBoundariesWithSegmenter(
  text: string,
  posInText: number,
  segmenter: SegmenterType
): { start: number; end: number } | null {
  const segments = Array.from(segmenter.segment(text));

  // Find segment containing cursor (strictly inside, not at boundary)
  for (const segment of segments) {
    const segStart = segment.index;
    const segEnd = segStart + segment.segment.length;

    // Cursor must be strictly inside the segment (not at boundary)
    if (posInText > segStart && posInText < segEnd) {
      // Skip non-word segments (punctuation, whitespace)
      if (!segment.isWordLike) return null;

      return { start: segStart, end: segEnd };
    }
  }

  return null;
}

/**
 * Find word boundaries using regex fallback.
 * Used when Intl.Segmenter is not available (Safari <16.4).
 * Supports ASCII and Latin extended characters.
 */
function findWordBoundariesWithRegex(
  text: string,
  posInText: number
): { start: number; end: number } | null {
  // Word characters: ASCII alphanumeric + Latin extended
  const wordChars = /[\w\u00C0-\u024F\u1E00-\u1EFF]/;

  // Check if position is valid
  if (posInText <= 0 || posInText >= text.length) {
    return null;
  }

  // Check if cursor is in a word character
  const charAtPos = text[posInText];
  const charBefore = text[posInText - 1];

  // Must be inside a word (not at boundary)
  if (!wordChars.test(charAtPos) && !wordChars.test(charBefore)) {
    return null;
  }

  // Find word boundaries
  let start = posInText;
  let end = posInText;

  // Expand backwards
  while (start > 0 && wordChars.test(text[start - 1])) {
    start--;
  }

  // Expand forwards
  while (end < text.length && wordChars.test(text[end])) {
    end++;
  }

  // Must have at least one character and cursor must be strictly inside
  if (start >= end || posInText <= start || posInText >= end) {
    return null;
  }

  return { start, end };
}

function getWordSegmentsWithRegex(text: string): WordSegment[] {
  const wordChars = /[\w\u00C0-\u024F\u1E00-\u1EFF]/;
  const segments: WordSegment[] = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && !wordChars.test(text[index])) {
      index++;
    }
    if (index >= text.length) break;
    const start = index;
    while (index < text.length && wordChars.test(text[index])) {
      index++;
    }
    segments.push({ start, end: index });
  }

  return segments;
}

/**
 * Reset the cached segmenter (for testing purposes only).
 * @internal
 */
export function _resetSegmenterCache(): void {
  cachedSegmenter = null;
  segmenterChecked = false;
}
