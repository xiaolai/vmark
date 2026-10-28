// @vitest-environment node
// composePieces is differential-tested against CodeMirror's own ChangeDesc.mapPos (MapMode.Simple): over seeded random documents and random chains of transactions given as individual sections (insertions, deletions, replacements, touching and point sections, both assoc sides), the composed piecewise map must equal mapping every original gap through each transaction in sequence, and the pieces must stay ordered and contiguous
import { describe, it, expect } from "vitest";
import { ChangeSet, type ChangeSpec } from "@codemirror/state";
import { composePieces, evaluate, validateChanges, type Piece, type Section } from "../pieces";

/** mulberry32: a seeded, exactly reproducible stand-in for Math.random. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rand: () => number, n: number) => Math.floor(rand() * n);

/** Up to four sorted, non-overlapping changes; equal endpoints make point and touching sections. */
function randomChange(rand: () => number, len: number): ChangeSet {
  const ends = Array.from({ length: 2 * (1 + int(rand, 4)) }, () => int(rand, len + 1)).sort((x, y) => x - y);
  const specs: ChangeSpec[] = [];
  for (let i = 0; i < ends.length; i += 2) {
    specs.push({ from: ends[i], to: ends[i + 1], insert: "x".repeat(int(rand, 4)) });
  }
  return ChangeSet.of(specs, len);
}

function sections(cs: ChangeSet): Section[] {
  const out: Section[] = [];
  cs.iterChanges((fromA, toA, fromB, toB) => out.push({ fromA, toA, fromB, toB }), true);
  return out;
}

function checkShape(pieces: readonly Piece[], lenA: number): void {
  expect(pieces[0].a).toBe(0);
  expect(pieces[pieces.length - 1].b).toBe(lenA);
  for (let i = 1; i < pieces.length; i++) expect(pieces[i].a).toBe(pieces[i - 1].b + 1);
}

describe("composePieces vs ChangeDesc.mapPos", () => {
  // Parity holds for individual sections (`iterChanges(f, true)`); joined
  // ranges describe the joined replacement and differ at touching changes.
  it.each([-1, 1])("assoc %i matches sequential mapPos over 500 seeded chains", (assoc) => {
    for (let seed = 1; seed <= 500; seed++) {
      const rand = seeded(seed * 7919 + (assoc < 0 ? 1 : 2));
      const lenA = int(rand, 12);
      let len = lenA;
      let pieces: Piece[] = [{ a: 0, b: lenA, s: 1, o: 0 }];
      let expected = Array.from({ length: lenA + 1 }, (_, p) => p);
      for (let step = 0; step < 1 + int(rand, 6); step++) {
        const cs = randomChange(rand, len);
        pieces = composePieces(pieces, validateChanges(sections(cs), len), assoc);
        expected = expected.map((v) => cs.mapPos(v, assoc));
        len = cs.newLength;
        const actual = expected.map((_, p) => evaluate(pieces, p));
        expect({ seed, step, actual }).toEqual({ seed, step, actual: expected });
        checkShape(pieces, lenA);
      }
    }
  });

  it("leaves the map unchanged for an empty transaction", () => {
    const pieces: Piece[] = [{ a: 0, b: 3, s: 1, o: 0 }];
    expect(composePieces(pieces, [], 1)).toEqual(pieces);
  });

  it("maps an empty document's single gap through an insertion at 0", () => {
    const cs = ChangeSet.of([{ from: 0, insert: "中文🙂" }], 0);
    for (const assoc of [-1, 1]) {
      const out = composePieces([{ a: 0, b: 0, s: 1, o: 0 }], sections(cs), assoc);
      expect(evaluate(out, 0)).toBe(cs.mapPos(0, assoc));
    }
  });

  // The accumulator composes a transaction in place, without copying it to drop
  // its no-op sections, so a no-op section must compose exactly as its absence.
  it.each([-1, 1])("assoc %i: no-op sections compose to exactly the pieces their absence gives", (assoc) => {
    for (let seed = 1; seed <= 500; seed++) {
      const rand = seeded(seed * 104729 + (assoc < 0 ? 1 : 2));
      const lenA = int(rand, 12);
      let len = lenA;
      let pieces: Piece[] = [{ a: 0, b: lenA, s: 1, o: 0 }];
      for (let step = 0; step < 1 + int(rand, 6); step++) {
        const cs = randomChange(rand, len);
        const real = sections(cs);
        const withNoops: Section[] = [];
        let prevToA = 0;
        let offset = 0;
        const noopUpTo = (end: number) => {
          const at = prevToA + int(rand, end - prevToA + 1);
          withNoops.push({ fromA: at, toA: at, fromB: at + offset, toB: at + offset });
        };
        for (const c of real) {
          if (rand() < 0.5) noopUpTo(c.fromA);
          withNoops.push(c);
          prevToA = c.toA;
          offset = c.toB - c.toA;
        }
        if (rand() < 0.5) noopUpTo(len);
        const expected = composePieces(pieces, validateChanges(real, len), assoc);
        expect({ seed, step, pieces: composePieces(pieces, withNoops, assoc) }).toEqual({ seed, step, pieces: expected });
        pieces = expected;
        len = cs.newLength;
      }
    }
  });

  it("leaves the map unchanged, piece for piece, for a transaction of no-op sections only", () => {
    const pieces: Piece[] = [
      { a: 0, b: 1, s: 1, o: 0 },
      { a: 2, b: 2, s: 1, o: 1 },
      { a: 3, b: 8, s: 0, o: 3 },
      { a: 9, b: 10, s: 1, o: -5 },
    ];
    for (const assoc of [-1, 1]) expect(composePieces(pieces, [{ fromA: 1, toA: 1, fromB: 1, toB: 1 }], assoc)).toEqual(pieces);
  });
});

