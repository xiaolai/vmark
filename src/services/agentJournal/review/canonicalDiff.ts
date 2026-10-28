/**
 * Canonical diff — turns two texts into the one canonical change list review
 * needs, by an exact semantic diff or by the linear trimmed fallback.
 *
 * Pipeline (both entries):
 *   1. refuse text that is not well-formed (`INVALID_TEXT`);
 *   2. raw changes: diff-match-patch with semantic cleanup (exact), or the
 *      common prefix/suffix trim (trimmed, O(n), at most one change);
 *   3. widen boundaries off surrogate pairs and merge changes that touch;
 *   4. place each pure insertion or deletion at the last line start of the
 *      range it can slide over, else its leftmost position — never inside a
 *      pair, never touching a neighbour — so placement does not depend on
 *      which library produced it;
 *   5. assert the result is canonical (`assertCanonical`).
 *
 * Key decisions:
 *   - The exact diff runs unbudgeted (`Diff_Timeout = 0`): the deadline is
 *     enforced by terminating the worker that runs it, never by a library
 *     timeout that degrades silently.
 *   - Two edits on one line stay two changes; grouping changes into review
 *     hunks is a later, separate step.
 *
 * @coordinates-with ./budgetedDiff.ts — runs the exact path in a worker, the trimmed path at the deadline
 * @module services/agentJournal/review/canonicalDiff
 */

import DiffMatchPatch from "diff-match-patch";
import { assertCanonical, assertWellFormed, midPair, repairAndMerge, trimmedChanges, type TextChange } from "./textChanges";

const dmp = new DiffMatchPatch();
dmp.Diff_Timeout = 0;

/** Raw diff-match-patch changes after semantic cleanup; empty parts dropped. */
function semanticChanges(a: string, b: string): TextChange[] {
  const parts = dmp.diff_main(a, b, true);
  dmp.diff_cleanupSemantic(parts);
  const out: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
  let posA = 0;
  let posB = 0;
  for (const [op, text] of parts) {
    const n = text.length;
    if (n === 0) continue;
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      posA += n;
      posB += n;
      continue;
    }
    const last = out.at(-1);
    const c = last && last.toA === posA && last.toB === posB ? last : { fromA: posA, toA: posA, fromB: posB, toB: posB };
    if (c !== last) out.push(c);
    if (op === DiffMatchPatch.DIFF_DELETE) c.toA = posA += n;
    else c.toB = posB += n;
  }
  return out;
}

/**
 * The starts in `[sMin, sMax]` at which the `len` units at `s0` of `x` can
 * sit with the same result; starts stay above `lo`, ends below `hi`.
 */
function slideRange(x: string, s0: number, len: number, lo: number, hi: number): { sMin: number; sMax: number } {
  let sMin = s0;
  let sMax = s0;
  while (sMin - 1 > lo && x.charCodeAt(sMin - 1) === x.charCodeAt(sMin - 1 + len)) sMin--;
  while (sMax + len + 1 < hi && x.charCodeAt(sMax + len) === x.charCodeAt(sMax)) sMax++;
  return { sMin, sMax };
}

/** Step 4: canonical placement of pure insertions and deletions. */
function placeChanges(a: string, b: string, changes: readonly TextChange[]): TextChange[] {
  const out: TextChange[] = [];
  changes.forEach((c, i) => {
    const ins = c.fromA === c.toA;
    const del = c.fromB === c.toB;
    if (ins === del) {
      out.push(c);
      return;
    }
    const x = ins ? b : a;
    const prev = out.at(-1);
    const next = changes[i + 1];
    const lo = prev ? (ins ? prev.toB : prev.toA) : -1;
    const hi = next ? (ins ? next.fromB : next.fromA) : x.length + 1;
    const s0 = ins ? c.fromB : c.fromA;
    const len = (ins ? c.toB : c.toA) - s0;
    const { sMin, sMax } = slideRange(x, s0, len, lo, hi);
    const fits = (s: number) => !midPair(x, s) && !midPair(x, s + len);
    let pick = -1;
    for (let s = sMax; s >= sMin && pick < 0; s--) if (fits(s) && (s === 0 || x.charCodeAt(s - 1) === 10)) pick = s;
    for (let s = sMin; s <= sMax && pick < 0; s++) if (fits(s)) pick = s;
    const d = pick < 0 ? 0 : pick - s0;
    out.push({ fromA: c.fromA + d, toA: c.toA + d, fromB: c.fromB + d, toB: c.toB + d });
  });
  return out;
}

function finish(a: string, b: string, raw: readonly TextChange[]): TextChange[] {
  const changes = placeChanges(a, b, repairAndMerge(a, raw));
  assertCanonical(a, b, changes);
  return changes;
}

/** The exact canonical change list from `a` to `b`. Unbounded time: run it where it can be killed. */
export function exactCanonicalDiff(a: string, b: string): TextChange[] {
  assertWellFormed(a, b);
  return a === b ? [] : finish(a, b, semanticChanges(a, b));
}

/** At most one canonical change covering everything between the common prefix and suffix. O(n). */
export function trimmedCanonicalDiff(a: string, b: string): TextChange[] {
  assertWellFormed(a, b);
  return finish(a, b, trimmedChanges(a, b));
}
