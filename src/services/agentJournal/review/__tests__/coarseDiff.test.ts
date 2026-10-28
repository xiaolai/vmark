// @vitest-environment node
// WI-AL2.1a — the coarse "too complex to split" change a budgeted diff settles with: the common prefix and suffix trimmed within a time budget, a canonical change that reconstructs the target whether the trim finished or stopped where the budget ran out, its boundaries never inside a surrogate pair
import { describe, expect, it } from "vitest";
import { coarseDiff, COARSE_CHUNK } from "../coarseDiff";
import { applyChanges, assertCanonical } from "../textChanges";

const never = () => 0;
const spent = () => 1;

describe("coarseDiff", () => {
  it.each([
    ["a replacement", "ab12cd", "aX12Yd", [{ fromA: 1, toA: 5, fromB: 1, toB: 5 }]],
    ["an insertion", "abc", "abXc", [{ fromA: 2, toA: 2, fromB: 2, toB: 3 }]],
    ["a deletion", "abXc", "abc", [{ fromA: 2, toA: 3, fromB: 2, toB: 2 }]],
    ["no change", "same", "same", []],
    ["an empty base", "", "new", [{ fromA: 0, toA: 0, fromB: 0, toB: 3 }]],
    ["a pair kept whole", "😀😀", "😁😁", [{ fromA: 0, toA: 4, fromB: 0, toB: 4 }]],
  ])("trims %s fully within its budget", (_, a, b, want) => {
    const got = coarseDiff(a, b, 1, never);
    expect(got).toEqual(want);
    assertCanonical(a, b, got);
  });

  it("stops trimming where the budget ran out, and the change still reconstructs the target", () => {
    const shared = "x".repeat(COARSE_CHUNK * 64);
    const a = `${shared}A${shared}`;
    const b = `${shared}B${shared}`;
    const got = coarseDiff(a, b, 1, spent);
    expect(got).toHaveLength(1);
    expect(got[0].fromA).toBeLessThanOrEqual(COARSE_CHUNK);
    expect(got[0].toA).toBe(a.length);
    assertCanonical(a, b, got);
    expect(applyChanges(a, b, got)).toBe(b);
  });

  it("never stops inside a surrogate pair", () => {
    const shared = "😀".repeat(COARSE_CHUNK);
    const a = `${shared}A`;
    const b = `${shared}B`;
    const got = coarseDiff(a, b, 1, spent);
    assertCanonical(a, b, got);
  });
});
