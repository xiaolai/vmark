import { describe, it, expect } from "vitest";
import {
  compareFingerprints,
  fingerprintOf,
  type ExpectedDivergence,
} from "./specFingerprints";
import type { Divergence } from "@/utils/markdownPipeline/conformance/projectionDiff";

const div = (over: Partial<Divergence> = {}): Divergence => ({
  path: "root.children[0]",
  kind: "type",
  detail: "link vs text",
  documentValue: "link",
  sourcePositionValue: "text",
  ...over,
});

const fp = (over: Partial<ExpectedDivergence> = {}): ExpectedDivergence => ({
  ...fingerprintOf(div()),
  ...over,
});

describe("compareFingerprints", () => {
  it("reports nothing when the observed set matches exactly", () => {
    expect(compareFingerprints([div()], [fp()])).toEqual({
      unexpected: [],
      missing: [],
    });
  });

  it("flags a NEW divergence on an already-declared example", () => {
    // The whole point: a declared example must not become a blanket licence.
    const result = compareFingerprints([div(), div({ path: "root.children[1]" })], [fp()]);
    expect(result.unexpected).toHaveLength(1);
    expect(result.unexpected[0].path).toBe("root.children[1]");
  });

  it("flags a stale pin that no longer occurs", () => {
    const result = compareFingerprints([], [fp()]);
    expect(result.missing).toHaveLength(1);
  });

  it("treats a changed VALUE as a different divergence", () => {
    const result = compareFingerprints([div({ sourcePositionValue: "emphasis" })], [fp()]);
    expect(result.unexpected).toHaveLength(1);
    expect(result.missing).toHaveLength(1);
  });

  it("counts duplicates one-to-one rather than collapsing them", () => {
    // A subset check would let a single expected entry satisfy both.
    const result = compareFingerprints([div(), div()], [fp()]);
    expect(result.unexpected).toHaveLength(1);
    expect(result.missing).toHaveLength(0);
  });

  it("matches structurally, not by key order", () => {
    const a = div({ documentValue: { a: 1, b: 2 } });
    const b = fp({ leftValue: { b: 2, a: 1 } });
    expect(compareFingerprints([a], [b]).unexpected).toEqual([]);
  });
});
