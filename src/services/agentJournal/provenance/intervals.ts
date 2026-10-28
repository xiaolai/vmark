/**
 * Provenance intervals — closed integer interval sets, sorted, with touching
 * intervals merged so the representation is canonical: `[[lo, hi], …]` with
 * `lo <= hi` and `next.lo > hi + 1`. Port of the golden reference the Rust
 * writer also reproduces (`agent_journal/provenance/intervals.rs`).
 *
 * @module services/agentJournal/provenance/intervals
 */

export type Interval = readonly [number, number];

/**
 * Streams additions into a copy of `set`, for callers that must stop early:
 * additions arrive with nondecreasing `lo`, so the output only ever grows
 * (each take appends or widens the last interval) and `length` is a lower
 * bound on the finished union's size. `finish()` gives the canonical union of
 * `set` and every addition.
 */
export class SortedUnion {
  readonly #set: readonly Interval[];
  readonly #out: [number, number][] = [];
  #i = 0;
  #lastLo = -Infinity;

  constructor(set: readonly Interval[]) {
    this.#set = set;
  }

  get length(): number {
    return this.#out.length;
  }

  /** Adds `[lo, hi]` (skipped when empty); throws if `lo` goes backwards. */
  add(lo: number, hi: number): void {
    if (lo > hi) return;
    if (lo < this.#lastLo) throw new Error(`interval additions out of order: ${lo} after ${this.#lastLo}`);
    this.#lastLo = lo;
    while (this.#i < this.#set.length && this.#set[this.#i][0] <= lo) this.#take(this.#set[this.#i++]);
    this.#take([lo, hi]);
  }

  finish(): Interval[] {
    while (this.#i < this.#set.length) this.#take(this.#set[this.#i++]);
    return this.#out;
  }

  #take([lo, hi]: Interval): void {
    const last = this.#out[this.#out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else this.#out.push([lo, hi]);
  }
}

/** Throws unless `set` is a canonical interval set within `[min, max]`. */
export function validateIntervals(set: unknown, min: number, max: number, what: string): Interval[] {
  if (!Array.isArray(set)) throw new Error(`malformed ${what}`);
  let prev = -Infinity;
  const out: Interval[] = [];
  for (const iv of set as unknown[]) {
    const ok =
      Array.isArray(iv) &&
      iv.length === 2 &&
      iv.every((n) => Number.isSafeInteger(n)) &&
      iv[0] <= iv[1] &&
      iv[0] >= min &&
      iv[1] <= max &&
      iv[0] > prev + 1;
    if (!ok) throw new Error(`malformed ${what}: ${JSON.stringify(iv)}`);
    const [a, b] = iv as [number, number];
    prev = b;
    out.push([a, b]);
  }
  return out;
}
