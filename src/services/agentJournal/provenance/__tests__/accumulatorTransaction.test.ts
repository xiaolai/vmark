// @vitest-environment node
// One transaction with many disjoint ranges (a replace-all) costs the accumulator time linear in its ranges, and a transaction past the cap still lands as a whole capOverflow barrier with the right length
import { describe, expect, it } from "vitest";
import { growthExponent, measureGrowth } from "@/test/cpuClock";
import { PROVENANCE_CAP, Provenance } from "../accumulator";
import type { Section } from "../pieces";

/** Deletes every other character of a `2k`-character document, in one transaction. */
function everyOtherDeleted(k: number): Section[] {
  return Array.from({ length: k }, (_, i) => ({ fromA: 2 * i, toA: 2 * i + 1, fromB: i, toB: i }));
}

describe("Provenance.compose — one transaction of many ranges", () => {
  it("records every deleted character of the transaction", () => {
    const k = 1000;
    const p = new Provenance(2 * k).compose(everyOtherDeleted(k));
    expect(p.whole).toBeNull();
    expect(p.lenB).toBe(k);
    expect(p.deletedChars).toEqual(Array.from({ length: k }, (_, i) => [2 * i, 2 * i]));
  });

  it("merges a transaction's ranges with the window's earlier effects", () => {
    const p = new Provenance(10).compose([{ fromA: 4, toA: 6, fromB: 4, toB: 4 }]);
    // Now 8 long; delete what was 2..3 and 6..7 (current 2..3 and 4..5) in one go.
    p.compose([
      { fromA: 2, toA: 4, fromB: 2, toB: 2 },
      { fromA: 4, toA: 6, fromB: 2, toB: 2 },
    ]);
    expect(p.deletedChars).toEqual([[2, 7]]);
    expect(p.lenB).toBe(4);
  });

  it("a single transaction past the cap becomes a whole capOverflow barrier", () => {
    const k = PROVENANCE_CAP;
    const p = new Provenance(2 * k).compose(everyOtherDeleted(k));
    expect(p.whole).toEqual({ reason: "capOverflow", origin: "accumulator" });
    expect(p.lenB).toBe(k);
    expect(p.transactions).toBe(1);
    expect(p.entries).toBeLessThanOrEqual(4);
  });

  it("costs time linear in the transaction's ranges, not quadratic", () => {
    const growth = measureGrowth((k: number) => new Provenance(2 * k).compose(everyOtherDeleted(k)), 500, 4000);
    expect(growthExponent(growth, 500, 4000)).toBeLessThan(1.5);
  });
});
