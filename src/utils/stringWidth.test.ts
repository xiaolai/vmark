import { describe, it, expect } from "vitest";
import { getDisplayWidth, padToWidth } from "./stringWidth";

describe("stringWidth", () => {
  describe("getDisplayWidth", () => {
    it("returns 0 for empty string", () => {
      expect(getDisplayWidth("")).toBe(0);
    });

    it("counts ASCII characters as width 1", () => {
      expect(getDisplayWidth("hello")).toBe(5);
      expect(getDisplayWidth("abc123")).toBe(6);
      expect(getDisplayWidth(" ")).toBe(1);
      expect(getDisplayWidth("!@#$%")).toBe(5);
    });

    it("counts CJK Unified Ideographs as width 2", () => {
      // CJK Unified Ideographs (0x4e00-0x9fff)
      expect(getDisplayWidth("中")).toBe(2);
      expect(getDisplayWidth("中文")).toBe(4);
      expect(getDisplayWidth("你好")).toBe(4);
      expect(getDisplayWidth("漢字")).toBe(4);
    });

    it("counts CJK Extension A as width 2", () => {
      // CJK Extension A (0x3400-0x4dbf)
      // Using characters in this range
      expect(getDisplayWidth("㐀")).toBe(2); // U+3400
    });

    it("counts CJK Compatibility Ideographs as width 2", () => {
      // CJK Compatibility (0xf900-0xfaff)
      expect(getDisplayWidth("豈")).toBe(2); // U+F900
    });

    it("counts CJK Punctuation as width 2", () => {
      // CJK Punctuation (0x3000-0x303f)
      expect(getDisplayWidth("　")).toBe(2); // U+3000 Ideographic space
      expect(getDisplayWidth("。")).toBe(2); // U+3002 Ideographic full stop
      expect(getDisplayWidth("「」")).toBe(4); // CJK brackets
    });

    it("counts Fullwidth Forms as width 2", () => {
      // Fullwidth variants (0xff01-0xff60)
      expect(getDisplayWidth("Ａ")).toBe(2); // U+FF21 Fullwidth A
      expect(getDisplayWidth("１")).toBe(2); // U+FF11 Fullwidth 1
      expect(getDisplayWidth("！")).toBe(2); // U+FF01 Fullwidth exclamation
    });

    it("counts halfwidth Katakana as width 1", () => {
      // U+FF65-FF9F halfwidth forms are narrow (East Asian Width "H").
      // Regression (Codex audit): the blanket FF00-FFEF range counted
      // them as width 2.
      expect(getDisplayWidth("ｱｲｳ")).toBe(3); // U+FF71 U+FF72 U+FF73
      expect(getDisplayWidth("ﾜｰﾄﾞ")).toBe(4); // includes U+FF70 and U+FF9E
      expect(getDisplayWidth("･")).toBe(1); // U+FF65 halfwidth middle dot
    });

    it("counts halfwidth CJK punctuation and Hangul as width 1", () => {
      expect(getDisplayWidth("｡｢｣")).toBe(3); // U+FF61-FF63
      expect(getDisplayWidth("ﾡﾢ")).toBe(2); // U+FFA1-FFA2 halfwidth hangul
    });

    it("still counts fullwidth signs as width 2", () => {
      expect(getDisplayWidth("￥")).toBe(2); // U+FFE5 fullwidth yen
      expect(getDisplayWidth("￠￡")).toBe(4); // U+FFE0-FFE1
    });

    it("handles mixed ASCII and CJK", () => {
      // "hello中文" = 5 (hello) + 4 (中文) = 9
      expect(getDisplayWidth("hello中文")).toBe(9);

      // "A中B文C" = 1 + 2 + 1 + 2 + 1 = 7
      expect(getDisplayWidth("A中B文C")).toBe(7);

      // "test123日本語" = 7 + 6 = 13
      expect(getDisplayWidth("test123日本語")).toBe(13);
    });

    it("handles multiline strings", () => {
      // Newline is ASCII width 1
      expect(getDisplayWidth("a\nb")).toBe(3);
      expect(getDisplayWidth("中\n文")).toBe(5);
    });

    it("handles emojis as width 1 (not in CJK ranges)", () => {
      // Emojis are not in the defined CJK ranges, so they get width 1
      // Note: This may not match visual width, but matches the function's definition
      expect(getDisplayWidth("😀")).toBe(1);
    });

    it("counts Hiragana as width 2", () => {
      // Hiragana (0x3040-0x309f)
      expect(getDisplayWidth("ひらがな")).toBe(8);
      expect(getDisplayWidth("あ")).toBe(2);
    });

    it("counts Katakana as width 2", () => {
      // Katakana (0x30a0-0x30ff)
      expect(getDisplayWidth("カタカナ")).toBe(8);
      expect(getDisplayWidth("ー")).toBe(2); // U+30FC prolonged sound mark
    });

    it("counts Hangul syllables as width 2", () => {
      // Hangul Syllables (0xac00-0xd7a3)
      expect(getDisplayWidth("한국어")).toBe(6);
      expect(getDisplayWidth("가")).toBe(2); // U+AC00
    });

    it("counts supplementary-plane Han (CJK Extension B+) as width 2", () => {
      // CJK Extension B starts at U+20000 — a surrogate pair in UTF-16,
      // which the for...of loop yields as one code point.
      expect(getDisplayWidth("𠀀")).toBe(2); // U+20000
      expect(getDisplayWidth("𠮷")).toBe(2); // U+20BB7 (jargon "yoshi")
    });

    it("handles mixed ASCII, kana, and hangul", () => {
      // "aあb한" = 1 + 2 + 1 + 2 = 6
      expect(getDisplayWidth("aあb한")).toBe(6);
    });
  });

  describe("padToWidth", () => {
    it("adds no padding when string already meets target width", () => {
      expect(padToWidth("hello", 5)).toBe("hello");
      expect(padToWidth("hello", 3)).toBe("hello"); // Already exceeds
    });

    it("adds no padding when string exceeds target width", () => {
      expect(padToWidth("hello", 3)).toBe("hello");
      expect(padToWidth("中文", 2)).toBe("中文"); // Width is 4
    });

    it("adds spaces to reach target width for ASCII", () => {
      expect(padToWidth("hi", 5)).toBe("hi   ");
      expect(padToWidth("a", 4)).toBe("a   ");
      expect(padToWidth("", 3)).toBe("   ");
    });

    it("adds correct padding for CJK strings", () => {
      // "中" has width 2, pad to 5 needs 3 spaces
      expect(padToWidth("中", 5)).toBe("中   ");

      // "中文" has width 4, pad to 6 needs 2 spaces
      expect(padToWidth("中文", 6)).toBe("中文  ");
    });

    it("adds correct padding for mixed strings", () => {
      // "A中" has width 3, pad to 5 needs 2 spaces
      expect(padToWidth("A中", 5)).toBe("A中  ");

      // "hello中" has width 7, pad to 10 needs 3 spaces
      expect(padToWidth("hello中", 10)).toBe("hello中   ");
    });

    it("handles zero target width", () => {
      expect(padToWidth("hi", 0)).toBe("hi");
      expect(padToWidth("", 0)).toBe("");
    });

    it("handles negative target width", () => {
      // Math.max(0, negative) = 0, so no padding
      expect(padToWidth("hi", -5)).toBe("hi");
    });
  });
});
