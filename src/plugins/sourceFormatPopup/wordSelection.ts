/**
 * Word Selection Utility
 *
 * Detects words at cursor position using Intl.Segmenter API.
 * Matches browser-native word selection behavior (double-click).
 */

import type { EditorView } from "@codemirror/view";

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
 * Get word range at cursor position using Intl.Segmenter.
 * Matches browser-native word selection behavior (double-click).
 * Returns null if cursor is in whitespace/punctuation or Segmenter unavailable.
 */
export function getWordAtCursor(
  view: EditorView
): { from: number; to: number } | null {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const lineText = line.text;
  const posInLine = from - line.from;

  const segmenter = getWordSegmenter();
  if (!segmenter) return null;

  const segments = Array.from(segmenter.segment(lineText));

  // Find segment containing cursor
  for (const segment of segments) {
    const segStart = segment.index;
    const segEnd = segStart + segment.segment.length;

    if (posInLine > segStart && posInLine < segEnd) {
      // Skip non-word segments (punctuation, whitespace)
      if (!segment.isWordLike) return null;

      return {
        from: line.from + segStart,
        to: line.from + segEnd,
      };
    }
  }

  return null;
}

/**
 * Select word at cursor position.
 * Dispatches selection change to editor and returns the new range.
 * Returns null if no word was found.
 */
export function selectWordAtCursor(
  view: EditorView
): { from: number; to: number } | null {
  const range = getWordAtCursor(view);
  if (!range) return null;

  view.dispatch({
    selection: { anchor: range.from, head: range.to },
  });

  return range;
}
