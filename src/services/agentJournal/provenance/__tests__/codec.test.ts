// @vitest-environment node
// WI-AL1.4 — the TypeScript provenance decoder refuses what the journal's Rust decoder refuses: unknown fields at every level of the body, wire integers past 2^53-1, interval endpoints past 2^53-1, and a run that would expand into more pieces than the cap allows (before allocating them)
import { describe, it, expect } from "vitest";
import { Provenance, type ProvenanceBody } from "../accumulator";
import { decodeProvenance } from "../codec";
import { validateIntervals } from "../intervals";

const UNSAFE = Number.MAX_SAFE_INTEGER + 1;

/** "abcd" → "a中文cd" with a bounded break and a touched gap: every body field populated. */
function body(): ProvenanceBody {
  return new Provenance(4)
    .compose([{ fromA: 1, toA: 2, fromB: 1, toB: 3 }])
    .breakRange(0, 1, 1, "uncertifiedRange", "test:range")
    .encode();
}

describe("decodeProvenance", () => {
  it("decodes the reference body", () => {
    const b = body();
    expect(decodeProvenance(b).encode()).toEqual(b);
    expect(b.breaks.bounded).toHaveLength(1);
  });

  it.each<[string, (b: ProvenanceBody & Record<string, unknown>) => void]>([
    ["body", (b) => Object.assign(b, { extra: 1 })],
    ["map", (b) => Object.assign(b.map, { extra: 1 })],
    ["breaks", (b) => Object.assign(b.breaks, { extra: 1 })],
    ["whole break", (b) => (b.breaks.whole = Object.assign({ reason: "snapshotOnly", origin: "t" }, { extra: 1 }))],
    ["bounded break", (b) => Object.assign(b.breaks.bounded[0], { extra: 1 })],
  ])("refuses an unknown field in the %s", (_where, mutate) => {
    const b = body() as ProvenanceBody & Record<string, unknown>;
    mutate(b);
    expect(() => decodeProvenance(b)).toThrow(/unknown/);
  });

  it.each<[string, (b: ProvenanceBody) => void]>([
    ["lenB", (b) => (b.lenB = UNSAFE)],
    ["transactions", (b) => (b.transactions = UNSAFE)],
    ["R0", (b) => (b.map.R0 = UNSAFE)],
    ["a run delta", (b) => (b.map.runs[b.map.runs.length - 1][2] = UNSAFE)],
  ])("refuses %s past 2^53-1", (_field, mutate) => {
    const b = body();
    mutate(b);
    expect(() => decodeProvenance(b)).toThrow();
  });

  it("refuses a run that expands past the cap before building it", () => {
    const n = 1_000_000;
    const hostile: ProvenanceBody = {
      lenA: n,
      lenB: 2 * n,
      transactions: 1,
      map: { L0: 0, R0: 0, runs: [[n, 2, 2]] },
      deletedChars: [],
      touchedGaps: [],
      breaks: { whole: null, bounded: [] },
    };
    expect(() => decodeProvenance(hostile, { cap: 4 })).toThrow(/cap/);
  });
});

describe("validateIntervals", () => {
  it("refuses endpoints past 2^53-1", () => {
    expect(() => validateIntervals([[UNSAFE, UNSAFE]], 0, Infinity, "deletedChars")).toThrow(/malformed/);
    expect(validateIntervals([[0, Number.MAX_SAFE_INTEGER]], 0, Infinity, "deletedChars")).toEqual([[0, Number.MAX_SAFE_INTEGER]]);
  });
});
