// @vitest-environment node
/**
 * Tests for the line-hunk differ backing the fidelity gate.
 *
 * The gate reports *what the pipeline changed about the author's text*, so the
 * differ must group consecutive changes into reviewable hunks rather than
 * emitting per-line noise, and must report nothing at all for identical input.
 *
 * @module utils/markdownPipeline/__tests__/fidelity/hunkDiff.test
 */
import { describe, it, expect } from "vitest";
import { hunkDiff } from "./hunkDiff";

describe("hunkDiff", () => {
  it("reports no hunks for identical text", () => {
    expect(hunkDiff("a\nb\nc", "a\nb\nc")).toEqual([]);
  });

  it("reports no hunks for empty input on both sides", () => {
    expect(hunkDiff("", "")).toEqual([]);
  });

  it("captures a replaced line as one hunk", () => {
    expect(hunkDiff("a\nb\nc", "a\nX\nc")).toEqual([{ before: ["b"], after: ["X"] }]);
  });

  it("captures a pure insertion (before side empty)", () => {
    expect(hunkDiff("a\nc", "a\nb\nc")).toEqual([{ before: [], after: ["b"] }]);
  });

  it("captures a pure deletion (after side empty)", () => {
    expect(hunkDiff("a\nb\nc", "a\nc")).toEqual([{ before: ["b"], after: [] }]);
  });

  it("groups consecutive changed lines into a single hunk", () => {
    expect(hunkDiff("a\nb\nc\nd", "a\nX\nY\nd")).toEqual([
      { before: ["b", "c"], after: ["X", "Y"] },
    ]);
  });

  it("separates non-adjacent changes into distinct hunks", () => {
    expect(hunkDiff("a\nb\nc\nd\ne", "a\nX\nc\nY\ne")).toEqual([
      { before: ["b"], after: ["X"] },
      { before: ["d"], after: ["Y"] },
    ]);
  });

  it("treats a trailing newline as a distinguishable line", () => {
    // "a" vs "a\n" — the serializer always terminates with a newline, and the
    // gate must be able to see (and a rule explain) that difference.
    expect(hunkDiff("a", "a\n")).toEqual([{ before: [], after: [""] }]);
  });

  it("handles a wholly rewritten document", () => {
    expect(hunkDiff("a\nb", "x\ny")).toEqual([{ before: ["a", "b"], after: ["x", "y"] }]);
  });
});
