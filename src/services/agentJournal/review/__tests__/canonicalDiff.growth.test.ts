// WI-AL2.1a — The canonical diff costs about linearly in the text length: the trimmed fallback (the path taken at the deadline, on the caller's thread) and the exact pipeline on a document with a fixed number of scattered edits, both timed on the test thread's CPU clock from 8k to 80k UTF-16 units; the exponent must stay below 1.35 (a quadratic step reads ~2).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { growthExponent, measureGrowth } from "@/test/cpuClock";
import { exactCanonicalDiff, trimmedCanonicalDiff } from "../canonicalDiff";

const SMALL = 8_000;
const LARGE = 80_000;
const MAX_EXPONENT = 1.35;

/** Mixed prose of about `units` UTF-16 units, with three scattered single-line edits in `b`. */
function pair(units: number): { a: string; b: string } {
  const line = "lorem 😀 甲乙 שלום ipsum dolor\n";
  const lines = Array.from({ length: Math.ceil(units / line.length) }, (_, i) => `${i % 10}${line}`);
  const a = lines.join("");
  const edited = [...lines];
  for (const at of [0.1, 0.5, 0.9]) {
    const i = Math.floor(lines.length * at);
    edited[i] = edited[i].replace("ipsum", "IPSUM 😁");
  }
  return { a, b: edited.join("") };
}

describe("canonical diff growth", () => {
  it.each([
    ["trimmed fallback", trimmedCanonicalDiff],
    ["exact pipeline, scattered edits", exactCanonicalDiff],
  ] as const)("%s grows about linearly with the text", (_, diff) => {
    const small = pair(SMALL);
    const large = pair(LARGE);
    const growth = measureGrowth((p: { a: string; b: string }) => void diff(p.a, p.b), small, large);
    expect(growthExponent(growth, small.a.length, large.a.length)).toBeLessThan(MAX_EXPONENT);
  });

  it("the exact pipeline finds the three edits, not one coarse run", () => {
    const { a, b } = pair(LARGE);
    expect(exactCanonicalDiff(a, b)).toHaveLength(3);
  });
});
