import { describe, it, expect } from "vitest";
import { normalizeLatex, isValidLatex, wrapForSource, isDisplayBlock } from "./operations";

describe("normalizeLatex", () => {
  it("trims whitespace but keeps body content", () => {
    expect(normalizeLatex("  x^2  ")).toBe("x^2");
    expect(normalizeLatex("\n\\sum_{i=1}^n i\n")).toBe("\\sum_{i=1}^n i");
  });
  it("returns empty string when input is whitespace-only", () => {
    expect(normalizeLatex("   ")).toBe("");
  });
});

describe("isValidLatex", () => {
  it.each([
    ["x", true],
    ["\\sum", true],
    ["", false],
    ["   ", false],
  ])("isValidLatex(%j) -> %s", (input, expected) => {
    expect(isValidLatex(input)).toBe(expected);
  });
});

describe("wrapForSource", () => {
  it("wraps inline with single dollars", () => {
    expect(wrapForSource("x^2", false)).toBe("$x^2$");
  });
  it("wraps display with double dollars", () => {
    expect(wrapForSource("x^2", true)).toBe("$$x^2$$");
  });
  it("trims whitespace before wrapping", () => {
    expect(wrapForSource("  x  ", true)).toBe("$$x$$");
  });
});

describe("isDisplayBlock", () => {
  it.each([
    ["$$x$$", true],
    ["$$\\sum_{i=1}^n i$$", true],
    ["$x$", false],
    ["$$x", false],
    ["x$$", false],
    ["", false],
  ])("isDisplayBlock(%j) -> %s", (input, expected) => {
    expect(isDisplayBlock(input)).toBe(expected);
  });
});
