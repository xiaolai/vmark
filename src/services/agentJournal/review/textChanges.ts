/**
 * Text changes — the change-list shape a review diff produces, the primitives
 * that build and repair it, and the assertion that a list is canonical.
 *
 * A change is `{ fromA, toA, fromB, toB }` in UTF-16 code units: `a` in
 * `[fromA, toA)` becomes `b` in `[fromB, toB)`, and text outside every change
 * is identical in both. A CANONICAL list is sorted, every change edits
 * something, no two changes touch (a gap of at least one unit separates
 * them), no boundary falls inside a surrogate pair on either side, and
 * applying the list to `a` reproduces `b` exactly.
 *
 * Key decisions:
 *   - Text that is not well-formed UTF-16 is refused with `InvalidTextError`
 *     (`INVALID_TEXT`), the journal's code for the same refusal: a lone
 *     surrogate has no UTF-8 form, so Rust could never agree on its ranges.
 *   - Repair widens a boundary by one unit. For well-formed text one unit is
 *     always enough: a boundary is mid-pair exactly when the shared unit
 *     before it is a high surrogate (or the shared unit after it is a low
 *     one), and that holds on both sides at once.
 *
 * @module services/agentJournal/review/textChanges
 */

import { isWellFormedText } from "../wellFormedText";

export interface TextChange {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
}

/** A diff input holds a lone surrogate. */
export class InvalidTextError extends Error {
  readonly code = "INVALID_TEXT";
  constructor(side: string) {
    super(`INVALID_TEXT: the ${side} text is not well-formed UTF-16 (lone surrogate)`);
    this.name = "InvalidTextError";
  }
}

/** A check reached its budget before it finished: nothing about the text is decided. */
export class OverBudget extends Error {
  constructor() {
    super("check stopped at its budget");
    this.name = "OverBudget";
  }
}

/** A clock and the instant past which a check stops with `OverBudget`. */
export interface CheckBudget {
  readonly until: number;
  readonly now: () => number;
}

const UNBOUNDED: CheckBudget = { until: Number.POSITIVE_INFINITY, now: () => 0 };

/** Code units a check works through between clock reads. */
export const CHECK_CHUNK = 1 << 16;

function checkBudget(budget: CheckBudget): void {
  if (budget.now() >= budget.until) throw new OverBudget();
}

/** Counts work and reads the clock once per `CHECK_CHUNK` units of it. */
function meter(budget: CheckBudget) {
  let units = 0;
  const check = () => checkBudget(budget);
  return {
    check,
    charge(n: number): void {
      units += n;
      if (units < CHECK_CHUNK) return;
      units = 0;
      check();
    },
  };
}

/** Whether `x` is well-formed, scanned a chunk at a time; a chunk never ends on a high surrogate. */
function wellFormedWithin(x: string, budget: CheckBudget): boolean {
  for (let i = 0; i < x.length; ) {
    let j = Math.min(x.length, i + CHECK_CHUNK);
    if (j < x.length && j - 1 > i && isHigh(x.charCodeAt(j - 1))) j--;
    if (!isWellFormedText(x.slice(i, j))) return false;
    i = j;
    checkBudget(budget);
  }
  return true;
}

/**
 * Throw `InvalidTextError` unless both texts are well-formed, or `OverBudget`
 * once `budget` runs out first (between chunks, so a lone surrogate in a
 * chunk already scanned is still reported).
 */
export function assertWellFormed(a: string, b: string, budget: CheckBudget = UNBOUNDED): void {
  if (!wellFormedWithin(a, budget)) throw new InvalidTextError("base");
  if (!wellFormedWithin(b, budget)) throw new InvalidTextError("target");
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Whether offset `p` of `x` falls between the two halves of a surrogate pair. */
export const midPair = (x: string, p: number): boolean =>
  p > 0 && p < x.length && isHigh(x.charCodeAt(p - 1)) && isLow(x.charCodeAt(p));

/** Apply `changes` to `a`, taking inserted text from `b`. */
export function applyChanges(a: string, b: string, changes: readonly TextChange[]): string {
  const parts: string[] = [];
  let pos = 0;
  for (const c of changes) {
    parts.push(a.slice(pos, c.fromA), b.slice(c.fromB, c.toB));
    pos = c.toA;
  }
  parts.push(a.slice(pos));
  return parts.join("");
}

/** The single change left after trimming the common prefix and suffix, unrepaired. O(n). */
export function trimmedChanges(a: string, b: string): TextChange[] {
  if (a === b) return [];
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return [{ fromA: p, toA: a.length - s, fromB: p, toB: b.length - s }];
}

/**
 * Widen every change so no boundary splits a surrogate pair, then merge
 * changes that overlap or touch. Input: sorted, consistent changes over
 * well-formed texts.
 */
export function repairAndMerge(a: string, changes: readonly TextChange[]): TextChange[] {
  const out: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
  for (const c0 of changes) {
    const c = { ...c0 };
    if (c.fromA > 0 && isHigh(a.charCodeAt(c.fromA - 1))) {
      c.fromA--;
      c.fromB--;
    }
    if (c.toA < a.length && isLow(a.charCodeAt(c.toA))) {
      c.toA++;
      c.toB++;
    }
    const last = out.at(-1);
    if (last && last.toA >= c.fromA) {
      last.toA = Math.max(last.toA, c.toA);
      last.toB = Math.max(last.toB, c.toB);
    } else out.push(c);
  }
  return out;
}

function fail(why: string, c?: TextChange): never {
  throw new Error(`diff not canonical: ${why}${c ? ` ${JSON.stringify(c)}` : ""}`);
}

/** Whether `a` from `fromA` and `b` from `fromB` agree for `length` units, compared a chunk at a time. */
function sameRun(a: string, fromA: number, b: string, fromB: number, length: number, m: ReturnType<typeof meter>): boolean {
  for (let k = 0; k < length; k += CHECK_CHUNK) {
    const n = Math.min(CHECK_CHUNK, length - k);
    if (a.slice(fromA + k, fromA + k + n) !== b.slice(fromB + k, fromB + k + n)) return false;
    m.charge(n);
  }
  return true;
}

/**
 * Fail loud unless `changes` is a canonical change list from `a` to `b`, or
 * throw `OverBudget` once `budget` runs out first. The list reproduces `b`
 * exactly when every unchanged gap reads the same on both sides, so the
 * gaps are compared in place rather than `b` rebuilt.
 */
export function assertCanonical(a: string, b: string, changes: readonly TextChange[], budget: CheckBudget = UNBOUNDED): void {
  const m = meter(budget);
  let prevA = 0;
  let prevB = 0;
  changes.forEach((c, i) => {
    const units = [c.fromA, c.toA, c.fromB, c.toB];
    if (!units.every((n) => Number.isSafeInteger(n) && n >= 0)) fail("offsets must be non-negative integers", c);
    if (c.toA < c.fromA || c.toB < c.fromB || c.toA > a.length || c.toB > b.length) fail("malformed change", c);
    if (i > 0 && c.fromA <= prevA) fail("changes overlap, touch or are out of order", c);
    if (c.fromA - prevA !== c.fromB - prevB) fail("unchanged gap differs between sides", c);
    if (c.fromA === c.toA && c.fromB === c.toB) fail("empty change", c);
    if (midPair(a, c.fromA) || midPair(a, c.toA) || midPair(b, c.fromB) || midPair(b, c.toB)) {
      fail("boundary inside a surrogate pair", c);
    }
    if (!sameRun(a, prevA, b, prevB, c.fromA - prevA, m)) fail("changes do not reconstruct the target");
    m.charge(1);
    prevA = c.toA;
    prevB = c.toB;
  });
  if (a.length - prevA !== b.length - prevB || !sameRun(a, prevA, b, prevB, a.length - prevA, m)) {
    fail("changes do not reconstruct the target");
  }
  m.check();
}
