// WI-AL2.1a — the WI-AL0.6 diff budget on the test thread's CPU clock: the exact diff of two 1 MB documents with 40 scattered edits, and the trimmed fallback the deadline takes, each cost under 200 ms per run at 1 MB and grow about linearly from 100 KB (exponent below 1.35)
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { growthExponent, measureGrowth } from "@/test/cpuClock";
import { exactCanonicalDiff, trimmedCanonicalDiff } from "../canonicalDiff";
import { DIFF_DEADLINE_MS } from "../diffBudget";

const SMALL = 100_000;
const LARGE = 1_000_000;
const EDITS = 40;
const MAX_EXPONENT = 1.35;

/** Mixed-script prose of about `units` UTF-16 units, and a copy with `EDITS` scattered line edits. */
function pair(units: number): { a: string; b: string } {
  const line = "lorem 😀 甲乙 שלום ipsum dolor sit amet\n";
  const lines = Array.from({ length: Math.ceil(units / line.length) }, (_, i) => `${i % 10}${line}`);
  const edited = [...lines];
  for (let k = 0; k < EDITS; k++) {
    const i = Math.floor(((k + 0.5) / EDITS) * lines.length);
    edited[i] = edited[i].replace("ipsum", "IPSUM 😁");
  }
  return { a: lines.join(""), b: edited.join("") };
}

describe("diff budget", () => {
  it("the diff pipeline stays within its CPU budget on the 1 MB fixture", () => {
    const small = pair(SMALL);
    const large = pair(LARGE);
    expect(large.a.length).toBeGreaterThanOrEqual(LARGE);
    expect(exactCanonicalDiff(large.a, large.b)).toHaveLength(EDITS);
    for (const diff of [exactCanonicalDiff, trimmedCanonicalDiff]) {
      const growth = measureGrowth((p: { a: string; b: string }) => void diff(p.a, p.b), small, large, { rounds: 3 });
      expect(growth.largeMs, `${diff.name} at 1 MB`).toBeLessThan(200);
      expect(growthExponent(growth, small.a.length, large.a.length)).toBeLessThan(MAX_EXPONENT);
    }
    expect(DIFF_DEADLINE_MS).toBeLessThanOrEqual(200);
  });
});
