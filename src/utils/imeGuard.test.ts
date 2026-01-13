import { describe, it, expect } from "vitest";
import { getImeCleanupPrefixLength, isImeKeyEvent } from "./imeGuard";

describe("imeGuard", () => {
  it("detects IME key events", () => {
    expect(isImeKeyEvent({ isComposing: true, keyCode: 0 })).toBe(true);
    expect(isImeKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeKeyEvent({ isComposing: false, keyCode: 0 })).toBe(false);
  });

  it("computes cleanup prefix for pinyin", () => {
    expect(getImeCleanupPrefixLength("wo我", "我")).toBe(2);
  });

  it("handles spaced pinyin prefixes", () => {
    expect(getImeCleanupPrefixLength("wo kj kj 我看看", "我看看")).toBe(9);
  });

  it("handles pinyin prefixes across paragraph breaks", () => {
    expect(getImeCleanupPrefixLength("wokjkj \n我看看", "我看看", { allowNewlines: true })).toBe(8);
  });

  it("skips cleanup when composed text is not CJK", () => {
    expect(getImeCleanupPrefixLength("woa", "a")).toBeNull();
  });

  it("skips cleanup when prefix has no letters", () => {
    expect(getImeCleanupPrefixLength("   我", "我")).toBeNull();
  });

  it("skips cleanup when prefix includes non-pinyin chars", () => {
    expect(getImeCleanupPrefixLength("wo-我", "我")).toBeNull();
  });
});
