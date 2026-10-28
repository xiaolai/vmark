// @vitest-environment node
// The provenance cap bounds what one transaction allocates, not only what the window keeps: a transaction whose effects or maps would pass the cap stops composing and lands as the same whole capOverflow barrier composing it fully would give, and an uncertified range the transaction would refuse leaves the window untouched
import { describe, expect, it } from "vitest";
import { ChangeSet, type ChangeSpec } from "@codemirror/state";
import { Provenance } from "../accumulator";
import { SortedUnion, type Interval } from "../intervals";
import { composePieces, lowerP, validateChanges, type Section } from "../pieces";

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

function randomSections(rand: () => number, len: number): Section[] {
  const ends = Array.from({ length: 2 * (1 + int(rand, 6)) }, () => int(rand, len + 1)).sort((x, y) => x - y);
  const specs: ChangeSpec[] = [];
  for (let i = 0; i < ends.length; i += 2) specs.push({ from: ends[i], to: ends[i + 1], insert: "x".repeat(int(rand, 3)) });
  const out: Section[] = [];
  ChangeSet.of(specs, len).iterChanges((fromA, toA, fromB, toB) => out.push({ fromA, toA, fromB, toB }), true);
  return out;
}

/** The plain union: sort the additions, then one sweep merging touching intervals. */
function unionIntervals(set: readonly Interval[], added: readonly Interval[]): Interval[] {
  const all = [...set, ...added.filter(([lo, hi]) => lo <= hi)].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of all) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** The unbounded algorithm: compose everything, then check the cap once. */
function referenceCompose(p: Provenance, changes: readonly Section[]): void {
  const sections = validateChanges(changes, p.lenB);
  const first = (side: "L" | "R", x: number, strict: boolean) => lowerP(side === "L" ? p.Lp : p.Rp, p.lenA, x, strict);
  const chars: Interval[] = [];
  const gaps: Interval[] = [];
  for (const { fromA: x0, toA: x1 } of sections) {
    if (x1 > x0) {
      const lo = Math.max(0, first("L", x0, true) - 1);
      const hi = Math.min(p.lenA - 1, first("R", x1, false) - 1);
      if (lo <= hi) chars.push([lo, hi]);
      gaps.push([first("R", x0, true), first("L", x1, false) - 1]);
    } else {
      gaps.push([first("R", x0, false), first("L", x0, true) - 1]);
    }
  }
  p.deletedChars = unionIntervals(p.deletedChars, chars);
  p.touchedGaps = unionIntervals(p.touchedGaps, gaps);
  if (sections.length > 0) {
    p.Lp = composePieces(p.Lp, sections, -1);
    p.Rp = composePieces(p.Rp, sections, 1);
    const last = sections[sections.length - 1];
    p.lenB += last.toB - last.toA;
  }
  p.transactions++;
  if (p.entries > p.cap) {
    p.whole ??= { reason: "capOverflow", origin: "accumulator" };
    p.Lp = [{ a: 0, b: p.lenA, s: 0, o: 0 }];
    p.Rp = [{ a: 0, b: p.lenA, s: 0, o: p.lenB }];
    p.deletedChars = p.lenA > 0 ? [[0, p.lenA - 1]] : [];
    p.touchedGaps = [[0, p.lenA]];
    p.bounded = [];
  }
}

/** Counts every Array push made while `run` executes (the transient allocations it builds). */
function pushesDuring(run: () => void): number {
  const original = Array.prototype.push;
  let count = 0;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    count += items.length;
    return original.apply(this, items);
  };
  try {
    run();
  } finally {
    Array.prototype.push = original;
  }
  return count;
}

describe("Provenance — the cap bounds a transaction's own allocations", () => {
  it("stops building effects and maps once the cap is certain to be passed", () => {
    const cap = 64;
    const k = 64 * cap;
    const changes = Array.from({ length: k }, (_, i) => ({ fromA: 2 * i, toA: 2 * i + 1, fromB: i, toB: i }));
    const p = new Provenance(2 * k, { cap });
    const pushes = pushesDuring(() => p.compose(changes));
    // Validation copies nothing: every allocation, validation's included, is bounded by the cap.
    expect(pushes).toBeLessThan(16 * cap);
    expect(p.whole).toEqual({ reason: "capOverflow", origin: "accumulator" });
    expect(p.lenB).toBe(k);
    expect(p.transactions).toBe(1);
  });

  it("gives exactly what composing in full and checking once gives", () => {
    const rand = seeded(0x91);
    for (let run = 0; run < 400; run++) {
      const lenA = int(rand, 40);
      const cap = 4 + int(rand, 37);
      const actual = new Provenance(lenA, { cap });
      const expected = new Provenance(lenA, { cap });
      for (let step = 0; step < 8; step++) {
        const changes = randomSections(rand, actual.lenB);
        if (rand() < 0.2 && changes.length > 0) {
          const { fromA, toA, fromB, toB } = changes[0];
          actual.breakRange(fromA, toA, toB - fromB, "uncertifiedRange", "test");
          if (expected.whole === null) {
            const range = { reason: "uncertifiedRange", origin: "test" };
            const first = (side: "L" | "R", x: number, strict: boolean) =>
              lowerP(side === "L" ? expected.Lp : expected.Rp, lenA, x, strict);
            expected.bounded.push({
              normal: [first("R", toA, true) - 1, first("L", fromA, false)],
              growing: [first("L", toA, true) - 1, first("R", fromA, false)],
              ...range,
            });
          }
          referenceCompose(expected, [changes[0]]);
        } else {
          actual.compose(changes);
          referenceCompose(expected, changes);
        }
        expect(actual.encode(), `run ${run} step ${step}`).toEqual(expected.encode());
      }
    }
  });
});

describe("Provenance.breakRange — refused before anything is recorded", () => {
  it.each([
    ["an insertion past 2^53-1", 0, 0, Number.MAX_SAFE_INTEGER],
    ["an unsafe insertion length", 0, 1, 2 ** 53],
  ])("%s leaves the window untouched", (_name, x0, x1, insLen) => {
    const p = new Provenance(4).compose([{ fromA: 1, toA: 2, fromB: 1, toB: 3 }]);
    const before = p.encode();
    expect(() => p.breakRange(x0, x1, insLen, "uncertifiedRange", "test")).toThrow();
    expect(p.encode()).toEqual(before);
    expect(p.bounded).toEqual([]);
  });
});

describe("SortedUnion", () => {
  it("merges sorted additions into the set, touching intervals joined", () => {
    const u = new SortedUnion([[0, 1], [5, 6], [20, 20]]);
    u.add(2, 3);
    u.add(8, 7);
    u.add(8, 9);
    expect(u.finish()).toEqual([[0, 3], [5, 6], [8, 9], [20, 20]]);
  });

  it("refuses additions that go backwards rather than build a wrong set", () => {
    const u = new SortedUnion([]);
    u.add(5, 6);
    expect(() => u.add(4, 4)).toThrow(/out of order/);
  });

  it("composes a no-op section in place exactly as its absence: no touched gap, same maps", () => {
    const withNoop = new Provenance(6).compose([
      { fromA: 1, toA: 1, fromB: 1, toB: 1 },
      { fromA: 3, toA: 4, fromB: 3, toB: 5 },
      { fromA: 5, toA: 5, fromB: 6, toB: 6 },
    ]);
    const without = new Provenance(6).compose([{ fromA: 3, toA: 4, fromB: 3, toB: 5 }]);
    expect(withNoop.encode()).toEqual(without.encode());
    expect(new Provenance(6).compose([{ fromA: 2, toA: 2, fromB: 2, toB: 2 }]).encode()).toEqual(new Provenance(6).compose([]).encode());
  });
});

