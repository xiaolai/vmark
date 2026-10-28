// @vitest-environment node
// The TypeScript decoder refuses what the Rust decoder refuses (body.rs, runs.rs): a bounded break that is not an uncertifiedRange, a whole break that is one, and a body no accumulator within the cap could hold — the map is rebuilt in the fewest pieces of each side, and the cap is checked against the entries the rebuilt accumulator actually holds
import { describe, expect, it } from "vitest";
import { BREAK_REASONS, Provenance, type ProvenanceBody } from "../accumulator";
import { decodeProvenance } from "../codec";
import { evaluate } from "../pieces";
import { piecesFromRuns } from "../runs";

/** One-character deletions at `at` (right to left, so each offset is the original one), under the widest cap. */
function deletions(lenA: number, at: number[]): Provenance {
  const p = new Provenance(lenA);
  for (const x of [...at].reverse()) p.compose([{ fromA: x, toA: x + 1, fromB: x, toB: x }]);
  return p;
}

const boundedBody = (): ProvenanceBody => new Provenance(10).breakRange(2, 4, 1, "uncertifiedRange", "window:blocks").encode();

describe("decodeProvenance — break classes", () => {
  it("decodes a bounded uncertified range", () => {
    const b = boundedBody();
    expect(decodeProvenance(b).encode()).toEqual(b);
  });

  it.each(BREAK_REASONS.filter((r) => r !== "uncertifiedRange"))("refuses a bounded break with the whole-document reason %s", (reason) => {
    const b = boundedBody();
    b.breaks.bounded[0].reason = reason;
    expect(() => decodeProvenance(b)).toThrow(/bounded break/);
  });

  it("decodes a whole break, and refuses one that names an uncertified range", () => {
    const p = new Provenance(10).breakWhole(3, "snapshotOnly", "snapshot");
    expect(decodeProvenance(p.encode()).encode()).toEqual(p.encode());
    const b = p.encode();
    b.breaks.whole = { reason: "uncertifiedRange", origin: "x" };
    expect(() => decodeProvenance(b)).toThrow(/whole break/);
  });
});

describe("decodeProvenance — the cap", () => {
  it("refuses a body that rebuilds more entries than its cap, though its runs fit twice the cap", () => {
    const p = deletions(20, [3, 9]);
    const b = p.encode();
    const cap = 4;
    expect(b.map.runs.length + b.deletedChars.length + b.touchedGaps.length + b.breaks.bounded.length).toBeLessThanOrEqual(2 * cap);
    expect(p.entries).toBeGreaterThan(cap);
    expect(() => decodeProvenance(b, { cap })).toThrow(/cap/);
    expect(decodeProvenance(b, { cap: p.entries }).encode()).toEqual(b);
  });
});

/** The fewest constant or slope-one stretches covering `values`, by trying every split. */
function fewestBySearch(values: number[]): number {
  const fits = (seg: number[]) => {
    const d = seg.slice(1).map((v, i) => v - seg[i]);
    return d.every((x) => x === 0) || d.every((x) => x === 1);
  };
  const best = new Array<number>(values.length + 1).fill(Infinity);
  best[0] = 0;
  for (let end = 1; end <= values.length; end++) {
    for (let start = 0; start < end; start++) {
      if (best[start] !== Infinity && fits(values.slice(start, end))) best[end] = Math.min(best[end], best[start] + 1);
    }
  }
  return best[values.length];
}

/** A small seeded generator: `next(m)` is in `0..m`. Mirrors `rng` in body.test.rs. */
function rng(seed: bigint): (m: number) => number {
  const MASK = (1n << 64n) - 1n;
  return (m) => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & MASK;
    return Number((seed >> 33n) % BigInt(Math.max(m, 1)));
  };
}

describe("piecesFromRuns — the fewest pieces", () => {
  it("rebuilds as few pieces as an exhaustive search finds, runs repeating a neighbour's delta included", () => {
    let seed = 0x9e3779b97f4a7c15n;
    const MASK = (1n << 64n) - 1n;
    for (let round = 0; round < 4000; round++) {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & MASK;
      const len = Number(seed >> 60n);
      const values = [0];
      const runs: [number, number][] = [];
      for (let i = 0; i < len; i++) {
        const delta = [0, 1, 1, 0, 2, 5][Number((seed >> BigInt((i * 3) % 57)) % 6n)];
        values.push(values[values.length - 1] + delta);
        const last = runs[runs.length - 1];
        if (last && last[1] === delta && ((seed >> BigInt(i)) & 1n) === 0n) last[0] += 1;
        else runs.push([1, delta]);
      }
      const pieces = piecesFromRuns(0, runs, len, 64);
      expect(pieces.length, JSON.stringify(runs)).toBe(fewestBySearch(values));
      values.forEach((v, g) => expect(evaluate(pieces, g), `${JSON.stringify(runs)} gap ${g}`).toBe(v));
    }
  });

  it("refuses runs whose fewest pieces exceed the bound", () => {
    // Gaps 0..4 hold 0, 2, 2, 2, 2: a point and a constant, two pieces.
    expect(piecesFromRuns(0, [[1, 2], [3, 0]], 4, 3)).toHaveLength(2);
    // Gaps 0..5 hold 0, 2, 7, 7, 7, 7: three pieces, over a bound of two.
    expect(() => piecesFromRuns(0, [[1, 2], [1, 5], [3, 0]], 5, 2)).toThrow(/cap/);
  });
});

describe("decodeProvenance — a small cap, several runs", () => {
  it("abc → c: the decoded accumulator holds no more entries than the cap it was admitted under", () => {
    const p = new Provenance(3, { cap: 64 });
    p.compose([{ fromA: 0, toA: 2, fromB: 0, toB: 0 }]);
    const body = p.encode();
    const decodedUnder = (cap: number): Provenance | null => {
      try {
        return decodeProvenance(body, { cap });
      } catch {
        return null;
      }
    };
    for (let cap = 4; cap <= 8; cap++) {
      const decoded = decodedUnder(cap);
      if (decoded) expect(decoded.entries, `cap ${cap}`).toBeLessThanOrEqual(cap);
    }
    // At the writer's own count it decodes, into no more entries than the writer held.
    const atWriter = decodeProvenance(body, { cap: Math.max(p.entries, 4) });
    expect(atWriter.entries).toBeLessThanOrEqual(Math.max(p.entries, 4));
  });

  it("random windows decode under the writer's entry count, never grow, and keep the map", () => {
    const next = rng(12345n);
    for (let round = 0; round < 5000; round++) {
      const p = new Provenance(next(12), { cap: 64 });
      for (let t = next(6); t > 0; t--) {
        const lb = p.lenB;
        const x0 = next(lb + 1);
        const x1 = x0 + next(lb - x0 + 1);
        p.compose([{ fromA: x0, toA: x1, fromB: x0, toB: x0 + next(3) }]);
      }
      const cap = Math.max(p.entries, 4);
      const d = decodeProvenance(p.encode(), { cap });
      expect(d.entries, JSON.stringify(p.encode().map)).toBeLessThanOrEqual(cap);
      for (let g = 0; g <= p.lenA; g++) {
        expect([evaluate(d.Lp, g), evaluate(d.Rp, g)]).toEqual([evaluate(p.Lp, g), evaluate(p.Rp, g)]);
      }
      expect(d.encode()).toEqual(p.encode());
    }
  });
});
