// @vitest-environment node
// WI-AL1.4 — the accumulator refuses what the codec and the Rust writer would later reject, before it mutates anything: a bounded break must be uncertifiedRange, a whole break must not be, and lengths must be safe integers
import { describe, expect, it } from "vitest";
import { Provenance } from "../accumulator";

const MAX = Number.MAX_SAFE_INTEGER;

describe("Provenance input contract", () => {
  it.each(["snapshotOnly", "capOverflow", "restore"])("a bounded break refuses %s and leaves the window untouched", (reason) => {
    const acc = new Provenance(4);
    expect(() => acc.breakRange(1, 2, 1, reason, "test")).toThrow(/bounded break/);
    expect(acc.bounded).toEqual([]);
    expect(acc.transactions).toBe(0);
  });

  it("a bounded break accepts uncertifiedRange", () => {
    const acc = new Provenance(4).breakRange(1, 2, 1, "uncertifiedRange", "test");
    expect(acc.bounded).toHaveLength(1);
  });

  it("a whole break refuses uncertifiedRange and leaves the window untouched", () => {
    const acc = new Provenance(4);
    expect(() => acc.breakWhole(3, "uncertifiedRange", "test")).toThrow(/whole break/);
    expect(acc.whole).toBeNull();
    expect(acc.transactions).toBe(0);
  });

  it.each([MAX, 0])("accepts the length %d", (n) => {
    expect(new Provenance(n).lenA).toBe(n);
    expect(new Provenance(0).breakWhole(n, "snapshotOnly", "test").lenB).toBe(n);
  });

  it.each([MAX + 1, 2 ** 60, -1, 1.5])("refuses the length %d", (n) => {
    expect(() => new Provenance(n)).toThrow(/malformed length/);
    expect(() => new Provenance(0).breakWhole(n, "snapshotOnly", "test")).toThrow(/malformed length/);
  });
});
