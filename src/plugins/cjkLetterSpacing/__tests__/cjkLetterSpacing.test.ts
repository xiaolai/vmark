// @vitest-environment node
/**
 * Tests for cjkLetterSpacing — CJK regex detection and extension structure.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CJKLetterSpacing } from "../index";

// The CJK_REGEX is module-private, so we replicate it for testing the pattern
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u3100-\u312f]+/g;

describe("CJK_REGEX pattern", () => {
  beforeEach(() => {
    CJK_REGEX.lastIndex = 0;
  });

  it("matches Chinese characters", () => {
    const text = "Hello \u4f60\u597d World";
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec(text);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("\u4f60\u597d");
  });

  it("matches Japanese hiragana", () => {
    const text = "Say \u3053\u3093\u306b\u3061\u306f please";
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec(text);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("\u3053\u3093\u306b\u3061\u306f");
  });

  it("matches Japanese katakana", () => {
    const text = "The \u30ab\u30bf\u30ab\u30ca word";
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec(text);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("\u30ab\u30bf\u30ab\u30ca");
  });

  it("matches Korean hangul", () => {
    const text = "Hello \ud55c\uad6d\uc5b4 world";
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec(text);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("\ud55c\uad6d\uc5b4");
  });

  it("matches Bopomofo characters", () => {
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec("\u3105\u3106\u3107");
    expect(match).not.toBeNull();
    expect(match![0]).toBe("\u3105\u3106\u3107");
  });

  it("does not match Latin characters", () => {
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec("Hello World");
    expect(match).toBeNull();
  });

  it("does not match numbers", () => {
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec("12345");
    expect(match).toBeNull();
  });

  it("finds multiple CJK runs in mixed text", () => {
    const text = "\u4f60\u597d hello \u4e16\u754c";
    const matches: string[] = [];
    CJK_REGEX.lastIndex = 0;
    let match;
    while ((match = CJK_REGEX.exec(text)) !== null) {
      matches.push(match[0]);
    }
    expect(matches).toEqual(["\u4f60\u597d", "\u4e16\u754c"]);
  });

  it("matches consecutive CJK characters as a single run", () => {
    const text = "\u4e00\u4e8c\u4e09\u56db\u4e94";
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec(text);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("\u4e00\u4e8c\u4e09\u56db\u4e94");
  });

  it("handles empty string", () => {
    CJK_REGEX.lastIndex = 0;
    const match = CJK_REGEX.exec("");
    expect(match).toBeNull();
  });
});

describe("CJKLetterSpacing extension", () => {
  it("has the correct name", () => {
    expect(CJKLetterSpacing.name).toBe("cjkLetterSpacing");
  });

  it("is an Extension type", () => {
    expect(CJKLetterSpacing.type).toBe("extension");
  });

  it("has default className option of 'cjk-spacing'", () => {
    // Access the default options
    const ext = CJKLetterSpacing.configure({});
    expect(ext.options.className).toBe("cjk-spacing");
  });

  it("allows className to be configured", () => {
    const ext = CJKLetterSpacing.configure({ className: "custom-cjk" });
    expect(ext.options.className).toBe("custom-cjk");
  });
});
