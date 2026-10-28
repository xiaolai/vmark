// @vitest-environment node
// WI-AL1.4 — a deferral's ranges must tile the base and the edited text exactly; anything else, including malformed elements a collector hands back at runtime, is a plain `false` (the session then breaks the window), never a throw
import { describe, it, expect } from "vitest";
import { isDeferredWhole, rangesFit, type DeferredOutcome } from "../window";

const fit = (ranges: unknown, base = "ab文c", after = "aX文c") => rangesFit(ranges as DeferredOutcome, base, after);

describe("rangesFit", () => {
  it("accepts ranges that tile both texts, and an empty list for equal texts", () => {
    expect(fit([{ from: 1, to: 2, insert: 1 }])).toBe(true);
    expect(fit([], "same", "same")).toBe(true);
  });

  it.each([
    ["a null element", [null]],
    ["an undefined element", [undefined]],
    ["a number element", [7]],
    ["a string element", ["1,2,1"]],
    ["a valid range then null", [{ from: 1, to: 2, insert: 1 }, null]],
  ])("refuses %s without throwing", (_label, ranges) => {
    expect(() => fit(ranges)).not.toThrow();
    expect(fit(ranges)).toBe(false);
  });

  it.each([
    ["a fractional bound", [{ from: 1.5, to: 2, insert: 1 }]],
    ["an unsafe bound", [{ from: 1, to: Number.MAX_SAFE_INTEGER + 2, insert: 1 }]],
    ["a missing insert", [{ from: 1, to: 2 }]],
    ["ranges out of order", [{ from: 2, to: 3, insert: 1 }, { from: 0, to: 1, insert: 1 }]],
    ["a range that does not reach the edit", [{ from: 0, to: 0, insert: 0 }]],
  ])("refuses %s", (_label, ranges) => {
    expect(fit(ranges)).toBe(false);
  });

  it("refuses null and non-arrays", () => {
    expect(fit(null)).toBe(false);
    expect(fit({ whole: "snapshotOnly", origin: "x" })).toBe(false);
  });
});

describe("isDeferredWhole", () => {
  const whole = (out: unknown) => isDeferredWhole(out as DeferredOutcome);

  it("accepts a known reason with an origin", () => {
    expect(whole({ whole: "capOverflow", origin: "wysiwyg" })).toBe(true);
  });

  it.each([
    ["an empty origin", { whole: "snapshotOnly", origin: "" }],
    ["a missing origin", { whole: "snapshotOnly" }],
    ["an unknown reason", { whole: "other", origin: "x" }],
  ])("refuses %s, so the session breaks the window itself rather than throw", (_label, out) => {
    expect(whole(out)).toBe(false);
  });
});
