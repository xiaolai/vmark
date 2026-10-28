/**
 * Provenance runs — the run-length form of a position function, as
 * persisted: per-position deltas `V(p) - V(p-1)` and their inverse, which
 * rebuilds the fewest pieces under a hard cap. Mirrors
 * `agent_journal/provenance/runs.rs`, so both decoders rebuild the same
 * accumulator from the same body.
 *
 * @coordinates-with pieces.ts — the piece form and its evaluation
 * @coordinates-with codec.ts — the decoder that rebuilds both sides
 * @module services/agentJournal/provenance/runs
 */

import { valueOf, type Piece } from "./pieces";

/** Run-length per-position deltas `V(p) - V(p-1)`, p = 1..lenA, as `[[count, delta], …]`. */
export function deltaRuns(pieces: readonly Piece[]): [number, number][] {
  const runs: [number, number][] = [];
  const push = (n: number, dv: number) => {
    if (n <= 0) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === dv) last[0] += n;
    else runs.push([n, dv]);
  };
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (i > 0) push(1, valueOf(piece, piece.a) - valueOf(pieces[i - 1], pieces[i - 1].b));
    push(piece.b - (piece.a + 1) + 1, piece.s);
  }
  return runs;
}

/**
 * Rebuilds the fewest pieces from `V(0)` and per-position delta runs
 * (adjacent runs may repeat a delta). A piece keeps a stretch of equal
 * deltas, each 0 or 1; where two runs of different keepable deltas meet, one
 * of the two deltas starts a new piece. Choosing the later one at the first
 * such meeting not already broken is optimal (the earlier is a leaf of a
 * path), so no accumulator holds this map in fewer pieces: a decoded
 * accumulator is never larger than the one that wrote it. Throws on a shape
 * pieces cannot hold, on a value past 2^53-1, or on more than `maxPieces`
 * pieces (a hostile body could otherwise expand one run into 2^53 points).
 */
export function piecesFromRuns(
  v0: number,
  runs: readonly (readonly [number, number])[],
  lenA: number,
  maxPieces: number,
): Piece[] {
  const merged = mergedRuns(runs, lenA);
  // Whether each run's first delta continues the piece before it.
  const joins = merged.map(([, dv]) => dv <= 1);
  for (let i = 1; i < merged.length; i++) {
    // The previous run's last delta is kept unless it is its first and was dropped.
    const [prevN, prevDv] = merged[i - 1];
    const prevLastKept = prevDv <= 1 && (prevN > 1 || joins[i - 1]);
    if (joins[i] && prevLastKept) joins[i] = false;
  }
  const out: Piece[] = [{ a: 0, b: 0, s: 1, o: safe(v0) }];
  let p = 1;
  let v = v0;
  merged.forEach(([n, dv], i) => {
    if (dv <= 1) {
      v = safe(v + dv * n);
      if (!joins[i]) start(out, p, v - dv * (n - 1));
      extend(out, p + n - 1, dv);
    } else {
      if (out.length + n > maxPieces) throw new Error("provenance runs exceed the cap");
      // Consecutive jumps of the same size (touching sections) are points, one per position.
      for (let q = p; q < p + n; q++) {
        v = safe(v + dv);
        start(out, q, v);
      }
    }
    if (out.length > maxPieces) throw new Error("provenance runs exceed the cap");
    p += n;
  });
  return out;
}

/** Validated runs covering positions `1..=lenA`, adjacent equal deltas merged. */
function mergedRuns(runs: readonly (readonly [number, number])[], lenA: number): [number, number][] {
  const out: [number, number][] = [];
  let covered = 0;
  for (const [n, dv] of runs) {
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(dv) || n < 1 || dv < 0 || covered + n > lenA) {
      throw new Error(`malformed provenance run ${JSON.stringify([n, dv])}`);
    }
    covered += n;
    const last = out[out.length - 1];
    if (last && last[1] === dv) last[0] += n;
    else out.push([n, dv]);
  }
  if (covered !== lenA) throw new Error(`malformed provenance runs: cover ${covered} positions, lenA is ${lenA}`);
  return out;
}

function safe(v: number): number {
  if (!Number.isSafeInteger(v)) throw new Error("provenance map exceeds 2^53-1");
  return v;
}

/** A new one-position piece at `p` with value `v` (a point is a slope piece). */
function start(out: Piece[], p: number, v: number): void {
  out.push({ a: p, b: p, s: 1, o: v - p });
}

/**
 * Extends the last piece through position `to` with per-position delta `dv`
 * (0 or 1); a one-position piece takes the slope.
 */
function extend(out: Piece[], to: number, dv: number): void {
  const last = out[out.length - 1];
  if (to === last.b) return; // still one position: it stays a point
  out[out.length - 1] =
    last.a === last.b && dv === 0 ? { a: last.a, b: to, s: 0, o: last.a + last.o } : { ...last, b: to };
}
