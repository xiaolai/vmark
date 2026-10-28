/**
 * Provenance codec — rebuild an accumulator from its persisted body, failing
 * loud on anything malformed. Behind `decodePayload` and
 * `verifyPayloadTexts`, which the tests run against the shared golden
 * vectors the journal's decoder reads too.
 *
 * Key decisions:
 *   - It refuses what the journal's decoder refuses: unknown fields at any
 *     level, wire integers past 2^53-1, and runs that would expand past the
 *     cap (checked while rebuilding, before the pieces exist).
 *   - Each side is rebuilt in its fewest pieces (`runs.ts`), so the
 *     accumulator returned is the smallest that holds this state and never
 *     larger than the one that wrote it.
 *   - A bounded break is always an `uncertifiedRange` and a whole break
 *     never is; a body whose rebuilt accumulator holds more entries than the
 *     cap is one that should have become a `capOverflow`, so it is refused.
 *     Both checks mirror `Provenance::decode` in
 *     `agent_journal/provenance/body.rs`.
 *
 * @module services/agentJournal/provenance/codec
 */

import { validateIntervals } from "./intervals";
import type { Piece } from "./pieces";
import { piecesFromRuns } from "./runs";
import { checkReason, Provenance, type Break, type BoundedBreak } from "./accumulator";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Throws on a field outside `keys`, as the journal's decoder (`deny_unknown_fields`) does. */
function exactKeys(v: Record<string, unknown>, keys: readonly string[], what: string): void {
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  if (extra.length > 0) throw new Error(`unknown ${what} fields ${extra.join(",")}`);
}

const BREAK_KEYS = ["reason", "origin"];

/**
 * L <= R at every gap, L(0) = 0 and R(lenA) = lenB (the map accounts for the
 * whole postimage, so no text before the first or after the last original
 * gap goes unrecorded), checked exactly in O(runs). Runs must be canonical
 * (maximal). Mirrors `check_map` in `agent_journal/provenance/body.rs`.
 */
function checkMap(L0: unknown, R0: unknown, runs: readonly unknown[], lenB: number): void {
  if (!Number.isSafeInteger(L0) || !Number.isSafeInteger(R0)) throw new Error("malformed provenance map origin");
  if (L0 !== 0) throw new Error("malformed provenance map: L(0) is not 0");
  let l = L0 as number;
  let r = R0 as number;
  let prev: number[] | null = null;
  if (l > r) throw new Error("malformed provenance map at gap 0");
  for (const run of runs) {
    if (!Array.isArray(run) || run.length !== 3) throw new Error(`malformed provenance run ${JSON.stringify(run)}`);
    const [n, dL, dR] = run as [number, number, number];
    if (prev && prev[1] === dL && prev[2] === dR) throw new Error("provenance runs are not canonical");
    l += dL;
    r += dR;
    if (l > r) throw new Error("malformed provenance map: L > R");
    l += dL * (n - 1);
    r += dR * (n - 1);
    if (l > r) throw new Error("malformed provenance map: L > R");
    prev = run as number[];
  }
  if (r !== lenB) throw new Error("malformed provenance map: R(lenA) is not lenB");
}

/** The map's two piece lists, each in its fewest pieces, from its runs; checked against `lenA`, `lenB` and the cap. */
function decodeMap(map: unknown, lenA: number, lenB: number, cap: number): { Lp: Piece[]; Rp: Piece[] } {
  if (!isRecord(map) || !Array.isArray(map.runs)) throw new Error("malformed provenance map");
  exactKeys(map, ["L0", "R0", "runs"], "provenance map");
  const runs = map.runs as unknown[];
  // The fewest pieces, so one side over the cap is already over it.
  const maxPieces = cap;
  const pick = (k: 1 | 2) =>
    runs.map((run) => {
      if (!Array.isArray(run) || run.length !== 3) throw new Error(`malformed provenance run ${JSON.stringify(run)}`);
      return [run[0], run[k]] as [number, number];
    });
  const lRuns = pick(1);
  const rRuns = pick(2);
  const Lp = piecesFromRuns(map.L0 as number, lRuns, lenA, maxPieces);
  const Rp = piecesFromRuns(map.R0 as number, rRuns, lenA, maxPieces);
  checkMap(map.L0, map.R0, runs, lenB);
  return { Lp, Rp };
}

/** The whole break and the bounded breaks, their thresholds within the original gaps `[-1, lenA + 1]`. */
function decodeBreaks(breaks: unknown, lenA: number): { whole: Break | null; bounded: BoundedBreak[] } {
  if (!isRecord(breaks) || !Array.isArray(breaks.bounded)) throw new Error("malformed breaks");
  exactKeys(breaks, ["whole", "bounded"], "breaks");
  let whole: Break | null = null;
  if (breaks.whole !== null) {
    if (!isRecord(breaks.whole)) throw new Error("malformed whole break");
    exactKeys(breaks.whole, BREAK_KEYS, "whole break");
    checkReason(breaks.whole.reason, breaks.whole.origin);
    if (breaks.whole.reason === "uncertifiedRange") throw new Error("a whole break cannot be uncertifiedRange");
    whole = { reason: breaks.whole.reason as string, origin: breaks.whole.origin as string };
  }
  const threshold = (t: unknown): [number, number] => {
    const ok =
      Array.isArray(t) &&
      t.length === 2 &&
      t.every((n) => Number.isSafeInteger(n)) &&
      t[0] >= -1 &&
      t[0] <= lenA &&
      t[1] >= 0 &&
      t[1] <= lenA + 1;
    if (!ok) throw new Error(`malformed break thresholds ${JSON.stringify(t)}`);
    return [t[0], t[1]];
  };
  const bounded = (breaks.bounded as unknown[]).map((x): BoundedBreak => {
    if (!isRecord(x)) throw new Error("malformed bounded break");
    exactKeys(x, ["normal", "growing", ...BREAK_KEYS], "bounded break");
    checkReason(x.reason, x.origin);
    if (x.reason !== "uncertifiedRange") throw new Error(`a bounded break cannot be ${String(x.reason)}`);
    return { normal: threshold(x.normal), growing: threshold(x.growing), reason: x.reason as string, origin: x.origin as string };
  });
  return { whole, bounded };
}

/** Rebuilds an accumulator from its persisted body; throws on anything malformed. */
export function decodeProvenance(body: unknown, opts: { cap?: number } = {}): Provenance {
  if (!isRecord(body)) throw new Error("malformed provenance body");
  exactKeys(body, ["lenA", "lenB", "transactions", "map", "deletedChars", "touchedGaps", "breaks"], "provenance body");
  const { lenA, lenB, transactions, map, deletedChars, touchedGaps, breaks } = body;
  if (![lenA, lenB, transactions].every((n) => Number.isSafeInteger(n) && (n as number) >= 0)) {
    throw new Error("malformed provenance lengths");
  }
  const P = new Provenance(lenA as number, opts);
  const { Lp, Rp } = decodeMap(map, P.lenA, lenB as number, P.cap);
  P.Lp = Lp;
  P.Rp = Rp;
  P.lenB = lenB as number;
  P.transactions = transactions as number;
  P.deletedChars = validateIntervals(deletedChars, 0, P.lenA - 1, "deletedChars");
  P.touchedGaps = validateIntervals(touchedGaps, 0, P.lenA, "touchedGaps");
  const decoded = decodeBreaks(breaks, P.lenA);
  P.whole = decoded.whole;
  P.bounded = decoded.bounded;
  // Rebuilt in the fewest pieces, so this is the fewest entries any
  // accumulator with this state holds: more than the cap is a state that
  // should have been a `capOverflow`.
  const entries = P.entries;
  if (entries > P.cap) throw new Error(`the provenance holds ${entries} entries, over its cap ${P.cap}`);
  return P;
}
