/**
 * Span mapping (test support) — maps a hunk span of a capture window's
 * original text through the window's accumulated provenance: where the span
 * lands, whether an edit hit or touched it, and the break that blocks it.
 * The TypeScript port of the golden spec's `mapSpan`, run against the shared
 * fixture so the accumulator's maps are proven to mean what the Rust writer
 * reads them as.
 *
 * Test support, not a `Provenance` method: the Rust writer maps spans in
 * production and no editor code calls this, so as a method it shipped in the
 * cold-start bundle with every session.
 */

import type { BoundedBreak, Provenance } from "../accumulator";
import type { Interval } from "../intervals";

/** True when the set meets `[lo, hi]` (false for an empty range). */
function intersects(set: readonly Interval[], lo: number, hi: number): boolean {
  if (lo > hi) return false;
  let a = 0;
  let b = set.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (set[mid][1] < lo) a = mid + 1;
    else b = mid;
  }
  return a < set.length && set[a][0] <= hi;
}

/** A hunk span of the window's original text, in UTF-16 gaps. */
export interface SpanInput {
  from: number;
  to: number;
  growing: boolean;
}

/** Maps `input` through `p` (see the golden spec, `mapSpan`). */
export function mapSpan(p: Provenance, { from, to, growing }: SpanInput) {
  // L and R validate both gaps before anything is read.
  const span = growing ? { from: p.L(from), to: p.R(to), growing } : { from: p.R(from), to: p.L(to), growing };
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const D = p.deletedChars;
  const T = p.touchedGaps;
  const hit = growing ? intersects(T, lo, hi) || intersects(D, lo, hi - 1) : intersects(D, lo, hi - 1) || intersects(T, lo + 1, hi - 1);
  const edited = hit || (growing ? intersects(D, lo - 1, hi) : from >= to && intersects(T, lo, hi));
  // An inverted span covers gaps [lo, hi], mapped onto [L(lo), R(hi)]: the growing hull.
  const reaches = (x: BoundedBreak) => {
    const [fromMax, toMin] = growing || from > to ? x.growing : x.normal;
    return lo <= fromMax && hi >= toMin;
  };
  const b = p.whole ?? p.bounded.find(reaches) ?? null;
  return { span, hit, edited, block: b && { reason: b.reason, origin: b.origin } };
}
