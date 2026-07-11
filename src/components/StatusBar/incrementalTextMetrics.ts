/**
 * Incremental Text Metrics
 *
 * Purpose: Segment-cached wrapper around the status-bar metrics pipeline
 * (`computeTextMetrics(stripMarkdown(...))`). The expensive metric kernel
 * (~12 regex passes plus several full code-point allocations — measured at
 * ~480 ms per flush on a ~1.9M-char CJK document) runs only for blocks not
 * seen in the previous pass; a cheap O(document) split/hash pass remains on
 * every call. A typical single-paragraph edit pays the kernel for one block
 * and sums cached entries for the rest.
 *
 * CRLF documents bypass the cache entirely (direct pipeline): the reference
 * pipeline's separators are LF-only, so CRLF text would segment into one
 * giant block and pay full cost anyway — the bypass keeps that explicit.
 *
 * How it works:
 *   1. The document is split into segments at blank-line runs (`\n{2,}`),
 *      keeping fenced-code spans atomic. Fence pairing mirrors the reference
 *      pipeline's lazy regex (```` ```[\s\S]*?``` ````): ``` markers are
 *      paired sequentially, and an unpaired trailing marker is literal text.
 *   2. Each segment's metrics come from the SAME kernel as the direct
 *      pipeline (`computeTextMetrics(stripMarkdown(segment))`), memoized by
 *      segment string in a two-generation cache: entries used in the current
 *      pass carry over; everything older is dropped, bounding memory to
 *      roughly two documents' worth of segments.
 *   3. Totals are the per-segment sums. All whitespace-insensitive metrics
 *      (words, charsNoSpaces, cjkChars, charsNoPunctuation) are exact.
 *
 * Documented divergence from the direct pipeline: `charsWithSpaces` counts
 * each stripped block plus exactly one 2-char blank-line separator between
 * consecutive non-empty blocks. Stray invisible whitespace at block edges
 * (e.g. a trailing space before a blank line) is not counted, where the
 * direct pipeline kept it. Malformed spans that cross a blank line (an
 * inline-code or link literal containing an empty line — invalid CommonMark)
 * strip per-block here rather than across blocks.
 *
 * @coordinates-with statusTextMetrics.ts — the per-segment metrics kernel
 * @coordinates-with StatusBarCounts.tsx — holds one cache per status bar
 * @module components/StatusBar/incrementalTextMetrics
 */

import {
  computeTextMetrics,
  stripMarkdown,
  type TextMetrics,
} from "./statusTextMetrics";

interface SegmentEntry {
  metrics: TextMetrics;
  /** True when the segment strips to a non-empty string (counts a separator). */
  nonEmpty: boolean;
  /**
   * True when the segment starts with a list/numbered-list marker. The
   * reference pipeline's list regexes begin with `^[\s]*`, which greedily
   * consumes the blank-line separator BEFORE the marker (all but the newline
   * the `^` anchors after), so such a block is preceded by a 1-char
   * separator in the stripped output instead of the usual 2-char "\n\n".
   */
  consumesLeadingSeparator: boolean;
}

// Mirrors the match-start condition of stripMarkdown's list regexes
// (`^[\s]*[-*+]\s+` and `^[\s]*\d+\.\s+`) applied at a segment boundary.
const LIST_START_RE = /^\s*(?:[-*+]|\d+\.)\s/;

/**
 * Pair ``` markers sequentially, mirroring the lazy reference regex.
 * Returns [start, end) ranges of complete fenced spans; a trailing unpaired
 * marker produces no range (it is literal text, exactly like the regex).
 */
function findFenceRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open = content.indexOf("```");
  while (open !== -1) {
    const close = content.indexOf("```", open + 3);
    if (close === -1) break;
    ranges.push([open, close + 3]);
    open = content.indexOf("```", close + 3);
  }
  return ranges;
}

/**
 * Split into segments at blank-line runs (`\n{2,}`) that fall outside fenced
 * spans. Fence interiors may contain blank lines; those must not split the
 * segment or the fence pair would be broken for the per-segment strip.
 */
function splitSegments(content: string): string[] {
  const fences = findFenceRanges(content);
  const separator = /\n{2,}/g;
  const segments: string[] = [];
  let fenceIdx = 0;
  let segmentStart = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(content)) !== null) {
    // Advance past fences that end before this separator candidate.
    while (fenceIdx < fences.length && fences[fenceIdx][1] <= match.index) {
      fenceIdx++;
    }
    // A newline run cannot straddle a fence boundary (fences start and end
    // with backticks), so containment of the run's start is containment of
    // the whole run.
    if (fenceIdx < fences.length && match.index >= fences[fenceIdx][0]) {
      continue; // inside a fence — not a block separator
    }
    segments.push(content.slice(segmentStart, match.index));
    segmentStart = match.index + match[0].length;
  }
  segments.push(content.slice(segmentStart));
  return segments;
}

const ZERO: TextMetrics = {
  words: 0,
  charsWithSpaces: 0,
  charsNoSpaces: 0,
  cjkChars: 0,
  charsNoPunctuation: 0,
};

function computeSegment(segment: string): SegmentEntry {
  const stripped = stripMarkdown(segment);
  return {
    metrics: computeTextMetrics(stripped),
    nonEmpty: stripped.length > 0,
    consumesLeadingSeparator: LIST_START_RE.test(segment),
  };
}

interface MetricsCacheOptions {
  /** Test hook: invoked once per kernel computation (i.e. per cache miss). */
  onSegmentComputed?: (segment: string) => void;
}

/**
 * Create a segment-cached metrics function. Each returned function owns its
 * cache; hold one per consumer (e.g. a ref in StatusBarCounts) so unrelated
 * documents don't share generations.
 */
export function createMetricsCache(
  options?: MetricsCacheOptions,
): (content: string) => TextMetrics {
  let prevGen = new Map<string, SegmentEntry>();

  return function computeCached(content: string): TextMetrics {
    // CRLF bypass — see the module header.
    if (content.includes("\r")) {
      return computeTextMetrics(stripMarkdown(content));
    }

    const nextGen = new Map<string, SegmentEntry>();
    const totals: TextMetrics = { ...ZERO };
    let seenNonEmpty = false;

    for (const segment of splitSegments(content)) {
      let entry = nextGen.get(segment) ?? prevGen.get(segment);
      if (!entry) {
        entry = computeSegment(segment);
        options?.onSegmentComputed?.(segment);
      }
      nextGen.set(segment, entry);

      const m = entry.metrics;
      totals.words += m.words;
      totals.charsWithSpaces += m.charsWithSpaces;
      totals.charsNoSpaces += m.charsNoSpaces;
      totals.cjkChars += m.cjkChars;
      totals.charsNoPunctuation += m.charsNoPunctuation;

      if (entry.nonEmpty) {
        // Separator before every non-empty block after the first: normally a
        // 2-char blank line ("\n\n"); 1 char when the block's list marker
        // consumed the separator in the reference pipeline (see SegmentEntry).
        if (seenNonEmpty) {
          totals.charsWithSpaces += entry.consumesLeadingSeparator ? 1 : 2;
        }
        seenNonEmpty = true;
      }
    }

    prevGen = nextGen;
    return totals;
  };
}
