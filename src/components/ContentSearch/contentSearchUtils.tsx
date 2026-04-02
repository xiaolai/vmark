/**
 * Content Search Utilities
 *
 * Purpose: Pure helper functions extracted from ContentSearch.tsx to keep
 * the main component file under the ~300-line guideline.
 *
 * @coordinates-with ContentSearch.tsx — UI consumer
 * @coordinates-with contentSearchStore.ts — FileSearchResult types
 * @module components/ContentSearch/contentSearchUtils
 */

import type { FileSearchResult } from "@/stores/contentSearchStore";

/** Render line content with match ranges highlighted, returning React nodes. */
export function renderHighlightedLine(
  text: string,
  ranges: { start: number; end: number }[]
): React.ReactNode {
  if (ranges.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    if (start > lastEnd) {
      parts.push(text.slice(lastEnd, start));
    }
    parts.push(
      <span key={i} className="content-search-highlight">
        {text.slice(start, end)}
      </span>
    );
    lastEnd = end;
  }

  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return parts;
}

/** Build a flat list of { fileIndex, matchIndex } for keyboard navigation. */
export function buildFlatIndex(
  results: FileSearchResult[]
): { fileIndex: number; matchIndex: number }[] {
  const flat: { fileIndex: number; matchIndex: number }[] = [];
  for (let fi = 0; fi < results.length; fi++) {
    for (let mi = 0; mi < results[fi].matches.length; mi++) {
      flat.push({ fileIndex: fi, matchIndex: mi });
    }
  }
  return flat;
}
