/**
 * Multi-cursor Grapheme Movement
 *
 * Purpose: Grapheme-cluster-aware single-character stepping for multi-cursor
 * horizontal movement. Plain ±1 code-unit stepping can land a cursor inside
 * a surrogate pair (emoji), a ZWJ sequence (👨‍👩‍👧), a flag emoji, or a
 * combining-character sequence; these helpers step over the whole cluster.
 *
 * Key decisions:
 *   - Intl.Segmenter with granularity "grapheme" (same API family the
 *     codebase already uses for words in utils/wordSegmentation.ts)
 *   - Only steps within a text node of the current textblock; any other
 *     adjacency (block boundary, inline atom) returns null so the caller
 *     falls back to ProseMirror's Selection.findFrom
 *   - Segmenter instance cached; null when the API is unavailable
 *
 * @coordinates-with horizontalMovement.ts — char-unit movement calls graphemeStepTarget
 * @module plugins/multiCursor/graphemeMovement
 */

import type { Node as PMNode } from "@tiptap/pm/model";

let cachedSegmenter: Intl.Segmenter | null = null;
let segmenterChecked = false;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (segmenterChecked) return cachedSegmenter;
  segmenterChecked = true;
  if (!("Segmenter" in Intl)) return null;
  cachedSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return cachedSegmenter;
}

/** Length in code units of the grapheme starting at `index`, or null at end. */
function nextGraphemeLength(segmenter: Intl.Segmenter, text: string, index: number): number | null {
  if (index >= text.length) return null;
  for (const segment of segmenter.segment(text.slice(index))) {
    return segment.segment.length;
  }
  /* v8 ignore next -- @preserve unreachable: non-empty string always yields a segment */
  return null;
}

/** Length in code units of the grapheme ending at `index`, or null at start. */
function prevGraphemeLength(segmenter: Intl.Segmenter, text: string, index: number): number | null {
  if (index <= 0) return null;
  let last: number | null = null;
  for (const segment of segmenter.segment(text.slice(0, index))) {
    last = segment.segment.length;
  }
  return last;
}

/**
 * Compute the position one grapheme cluster away from `pos` in direction
 * `dir`, staying within the adjacent text node of the current textblock.
 * Returns null when the adjacent content is not text (block boundary,
 * inline atom) or when Intl.Segmenter is unavailable — callers fall back
 * to ProseMirror's own position stepping.
 */
export function graphemeStepTarget(doc: PMNode, pos: number, dir: -1 | 1): number | null {
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return null;

  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  const offset = $pos.parentOffset;
  const child = dir > 0 ? parent.childAfter(offset) : parent.childBefore(offset);
  if (!child.node || !child.node.isText || typeof child.node.text !== "string") return null;

  const localOffset = offset - child.offset;
  const step = dir > 0
    ? nextGraphemeLength(segmenter, child.node.text, localOffset)
    : prevGraphemeLength(segmenter, child.node.text, localOffset);
  if (step === null) return null;

  return pos + dir * step;
}

