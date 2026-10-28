/**
 * Provenance accumulator — one per capture window: the composed boundary
 * map of every certified transaction since the window opened, both
 * affinities (L: assoc -1, R: assoc +1, transaction by transaction), the
 * effects (original characters deleted, original gaps touched) and the
 * sticky breaks: bounded barriers over a range nothing certified, and the
 * whole-document barrier. Port of the golden reference; the Rust writer
 * (`agent_journal/provenance/accumulator.rs`) checks what this produces.
 *
 * Key decisions:
 *   - A hard entry cap: past it the window becomes a whole `capOverflow`
 *     break (origin `accumulator`), so memory is bounded and nothing is
 *     certified that was not kept. It also bounds what one transaction
 *     builds: effects stream into the sets and the maps compose under the
 *     entries left, and the moment the kept entries alone pass the cap the
 *     transaction stops and lands as that break. Every partial count only
 *     grows, so this gives exactly what composing in full and checking once
 *     (as the Rust writer does) gives.
 *   - Breaks are sticky: nothing clears them but a new window.
 *   - Inputs the codec and the Rust writer would reject are refused before
 *     anything changes: a bounded break is always `uncertifiedRange`, a
 *     whole break never is, and every length is a safe integer.
 *
 * @module services/agentJournal/provenance/accumulator
 */

import { SortedUnion, type Interval } from "./intervals";
import { checkChanges, composePieces, evaluate, isNoop, lowerP, type Piece, type Section } from "./pieces";
import { deltaRuns } from "./runs";

/** Hard memory cap in entries (pieces of L and R, effect intervals, bounded breaks). */
export const PROVENANCE_CAP = 16384;
/**
 * Smallest cap the journal accepts (`MIN_PROVENANCE_CAP` in
 * `agent_journal/provenance/mod.rs`): the identity map alone is two entries
 * and the whole-document fallback up to four, so a smaller cap could not hold
 * the representation it falls back to.
 */
export const MIN_PROVENANCE_CAP = 4;

export const BREAK_REASONS = [
  "snapshotOnly",
  "wholeDocumentWrite",
  "externalReload",
  "restore",
  "uncertifiedRange",
  "capOverflow",
  "unclosedEpoch",
  "parentMismatch",
] as const;
export type BreakReason = (typeof BREAK_REASONS)[number];

export interface Break {
  reason: string;
  origin: string;
}
export interface BoundedBreak extends Break {
  normal: [number, number];
  growing: [number, number];
}

export function checkReason(reason: unknown, origin: unknown): void {
  if (!(BREAK_REASONS as readonly unknown[]).includes(reason)) throw new Error(`unknown break reason ${JSON.stringify(reason)}`);
  if (typeof origin !== "string" || origin === "") throw new Error("a break needs an origin");
}

export interface ProvenanceBody {
  lenA: number;
  lenB: number;
  transactions: number;
  map: { L0: number; R0: number; runs: [number, number, number][] };
  deletedChars: [number, number][];
  touchedGaps: [number, number][];
  breaks: { whole: Break | null; bounded: BoundedBreak[] };
}

export class Provenance {
  readonly lenA: number;
  lenB: number;
  readonly cap: number;
  Lp: Piece[];
  Rp: Piece[];
  deletedChars: Interval[] = [];
  touchedGaps: Interval[] = [];
  whole: Break | null = null;
  bounded: BoundedBreak[] = [];
  transactions = 0;

  constructor(lenA: number, { cap = PROVENANCE_CAP }: { cap?: number } = {}) {
    if (!Number.isSafeInteger(lenA) || lenA < 0) throw new Error(`malformed length ${lenA}`);
    if (!Number.isInteger(cap) || cap < MIN_PROVENANCE_CAP || cap > PROVENANCE_CAP) throw new Error(`malformed cap ${cap}`);
    this.lenA = lenA;
    this.lenB = lenA;
    this.cap = cap;
    this.Lp = [{ a: 0, b: lenA, s: 1, o: 0 }];
    this.Rp = this.Lp;
  }

  /** An independent copy: what one is later fed never reaches the other. */
  clone(): Provenance {
    const c = new Provenance(this.lenA, { cap: this.cap });
    c.lenB = this.lenB;
    c.Lp = [...this.Lp];
    c.Rp = [...this.Rp];
    c.deletedChars = this.deletedChars.map(([a, b]) => [a, b]);
    c.touchedGaps = this.touchedGaps.map(([a, b]) => [a, b]);
    c.whole = this.whole && { ...this.whole };
    c.bounded = this.bounded.map((x) => ({ ...x, normal: [...x.normal], growing: [...x.growing] }));
    c.transactions = this.transactions;
    return c;
  }

  get entries(): number {
    return this.Lp.length + this.Rp.length + this.deletedChars.length + this.touchedGaps.length + this.bounded.length;
  }

  #gap(p: number): number {
    if (!Number.isInteger(p) || p < 0 || p > this.lenA) throw new Error(`gap ${p} outside [0, ${this.lenA}]`);
    return p;
  }
  L(p: number): number {
    return evaluate(this.Lp, this.#gap(p));
  }
  R(p: number): number {
    return evaluate(this.Rp, this.#gap(p));
  }
  #first(side: "L" | "R", x: number, strict: boolean): number {
    return lowerP(side === "L" ? this.Lp : this.Rp, this.lenA, x, strict);
  }

  #charsIn(x0: number, x1: number): [number, number] | null {
    const lo = Math.max(0, this.#first("L", x0, true) - 1);
    const hi = Math.min(this.lenA - 1, this.#first("R", x1, false) - 1);
    return lo <= hi ? [lo, hi] : null;
  }

  /**
   * Adds one section's effects, read through the maps as they were before
   * the transaction. Sections come sorted and `lowerP` is monotone, so both
   * streams arrive in nondecreasing `lo` order.
   */
  #effects({ fromA: x0, toA: x1 }: Section, chars: SortedUnion, gaps: SortedUnion): void {
    if (x1 > x0) {
      const deleted = this.#charsIn(x0, x1);
      if (deleted) chars.add(deleted[0], deleted[1]);
      gaps.add(this.#first("R", x0, true), this.#first("L", x1, false) - 1);
    } else {
      gaps.add(this.#first("R", x0, false), this.#first("L", x0, true) - 1);
    }
  }

  /** Composes one certified transaction, given as CodeMirror sections (`iterChanges(f, true)`). */
  compose(changes: readonly Section[]): this {
    // Checked without a copy: a refused or overflowing transaction allocates
    // nothing in proportion to its size; no-op sections are skipped in place.
    const lenB = this.lenB + checkChanges(changes, this.lenB);
    this.transactions++;
    // @edge-case A replace-all of thousands of ranges: the effects stream into
    // the sets in one sweep, and nothing grows past the cap before it stops.
    const chars = new SortedUnion(this.deletedChars);
    const gaps = new SortedUnion(this.touchedGaps);
    const over = () => chars.length + gaps.length + this.bounded.length > this.cap;
    for (const c of changes) {
      if (isNoop(c)) continue;
      this.#effects(c, chars, gaps);
      if (over()) return this.#capOverflow(lenB);
    }
    const deletedChars = chars.finish();
    const touchedGaps = gaps.finish();
    let room = this.cap - deletedChars.length - touchedGaps.length - this.bounded.length;
    const Lp = room < 0 ? null : composePieces(this.Lp, changes, -1, room);
    if (Lp === null) return this.#capOverflow(lenB);
    room -= Lp.length;
    const Rp = room < 0 ? null : composePieces(this.Rp, changes, 1, room);
    if (Rp === null) return this.#capOverflow(lenB);
    this.deletedChars = deletedChars;
    this.touchedGaps = touchedGaps;
    this.Lp = Lp;
    this.Rp = Rp;
    this.lenB = lenB;
    return this;
  }

  #capOverflow(lenB: number): this {
    this.#wholeBreak(lenB, "capOverflow", "accumulator");
    return this;
  }

  /** An uncertified replacement of `[x0, x1)` by `insLen` characters: a sticky bounded barrier. */
  breakRange(x0: number, x1: number, insLen: number, reason: string, origin: string): this {
    checkReason(reason, origin);
    if (reason !== "uncertifiedRange") throw new Error(`a bounded break cannot be ${reason}`);
    const ok = [x0, x1, insLen].every((n) => Number.isSafeInteger(n)) && x0 >= 0 && x0 <= x1 && x1 <= this.lenB && insLen >= 0;
    if (!ok) throw new Error(`malformed break range ${JSON.stringify([x0, x1, insLen])} (length ${this.lenB})`);
    const section = { fromA: x0, toA: x1, fromB: x0, toB: x0 + insLen };
    // @edge-case Refused before the sticky break is recorded, so a range the
    // transaction would refuse (a result past 2^53-1) changes nothing.
    checkChanges([section], this.lenB);
    if (this.whole === null) {
      this.bounded.push({
        normal: [this.#first("R", x1, true) - 1, this.#first("L", x0, false)],
        growing: [this.#first("L", x1, true) - 1, this.#first("R", x0, false)],
        reason,
        origin,
      });
    }
    return this.compose([section]);
  }

  /** The whole document was replaced with no certified mapping; the first reason is kept. */
  breakWhole(lenB: number, reason: string, origin: string): this {
    checkReason(reason, origin);
    if (reason === "uncertifiedRange") throw new Error("a whole break cannot be uncertifiedRange");
    if (!Number.isSafeInteger(lenB) || lenB < 0) throw new Error(`malformed length ${lenB}`);
    this.#wholeBreak(lenB, reason, origin);
    this.transactions++;
    return this;
  }

  #wholeBreak(lenB: number, reason: string, origin: string): void {
    this.whole ??= { reason, origin };
    this.Lp = [{ a: 0, b: this.lenA, s: 0, o: 0 }];
    this.Rp = [{ a: 0, b: this.lenA, s: 0, o: lenB }];
    this.deletedChars = this.lenA > 0 ? [[0, this.lenA - 1]] : [];
    this.touchedGaps = [[0, this.lenA]];
    this.bounded = [];
    this.lenB = lenB;
  }

  /**
   * Every original character outside `deletedChars` must survive as one unit
   * holding the same UTF-16 unit in `post`. Throws naming the first that
   * does not: hashes and lengths alone let a map lie about where text went.
   */
  checkTexts(pre: string, post: string): void {
    let d = 0;
    for (let i = 0; i < this.lenA; i++) {
      while (d < this.deletedChars.length && this.deletedChars[d][1] < i) d++;
      if (d < this.deletedChars.length && this.deletedChars[d][0] <= i) continue;
      const at = this.R(i);
      if (this.L(i + 1) !== at + 1 || post.charCodeAt(at) !== pre.charCodeAt(i)) {
        throw new Error(`original character ${i} survives the map but not the texts`);
      }
    }
  }

  /** The canonical persisted body. */
  encode(): ProvenanceBody {
    return {
      lenA: this.lenA,
      lenB: this.lenB,
      transactions: this.transactions,
      map: { L0: evaluate(this.Lp, 0), R0: evaluate(this.Rp, 0), runs: zipRuns(deltaRuns(this.Lp), deltaRuns(this.Rp)) },
      deletedChars: this.deletedChars.map(([a, b]) => [a, b]),
      touchedGaps: this.touchedGaps.map(([a, b]) => [a, b]),
      breaks: {
        whole: this.whole && { ...this.whole },
        bounded: this.bounded.map((x) => ({ normal: [...x.normal], growing: [...x.growing], reason: x.reason, origin: x.origin })),
      },
    };
  }
}

/** Joins the L and R delta runs into `[count, dL, dR]` runs over the same positions. */
function zipRuns(l: [number, number][], r: [number, number][]): [number, number, number][] {
  const out: [number, number, number][] = [];
  let i = 0;
  let j = 0;
  let li = l[0]?.[0] ?? 0;
  let rj = r[0]?.[0] ?? 0;
  while (i < l.length && j < r.length) {
    const n = Math.min(li, rj);
    const last = out[out.length - 1];
    if (last && last[1] === l[i][1] && last[2] === r[j][1]) last[0] += n;
    else out.push([n, l[i][1], r[j][1]]);
    li -= n;
    rj -= n;
    if (li === 0 && ++i < l.length) li = l[i][0];
    if (rj === 0 && ++j < r.length) rj = r[j][0];
  }
  return out;
}
