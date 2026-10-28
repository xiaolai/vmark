/**
 * Coarse diff — the one "too complex to split" change a budgeted diff
 * settles with: the common prefix and suffix trimmed, within a time budget.
 *
 * Key decisions:
 *   - The trim reads the clock every `COARSE_CHUNK` units and stops where it
 *     is once the budget is spent: an untrimmed remainder is still a correct
 *     change, only a coarser one. Nothing here does work the budget does not
 *     bound.
 *   - The caller validated both texts; nothing here scans them again.
 *   - Canonical by construction: the prefix and suffix were compared unit
 *     by unit, and the boundaries move off surrogate pairs. A pure insertion
 *     or deletion is not placed (placement slides over a run of repeats,
 *     which is linear); only exact results are placed.
 *
 * @coordinates-with ./budgetedDiff.ts — settles a job with it
 * @coordinates-with ./canonicalDiff.ts — the unbudgeted trimmed pipeline
 * @module services/agentJournal/review/coarseDiff
 */

import { repairAndMerge, type TextChange } from "./textChanges";

/** Units compared between clock reads. */
export const COARSE_CHUNK = 1 << 14;

/** The trimmed change from `a` to `b`, trimming only until `now()` reaches `until`. Both texts must be well-formed. */
export function coarseDiff(a: string, b: string, until: number, now: () => number): TextChange[] {
  const max = Math.min(a.length, b.length);
  let open = true;
  let p = 0;
  while (open && p < max) {
    const stop = Math.min(max, p + COARSE_CHUNK);
    while (p < stop && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    if (p < stop) break;
    open = now() < until;
  }
  let s = 0;
  while (open && s < max - p) {
    const stop = Math.min(max - p, s + COARSE_CHUNK);
    while (s < stop && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    if (s < stop) break;
    open = now() < until;
  }
  if (p === a.length - s && p === b.length - s) return [];
  return repairAndMerge(a, [{ fromA: p, toA: a.length - s, fromB: p, toB: b.length - s }]);
}
