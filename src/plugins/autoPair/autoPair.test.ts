/**
 * Auto-Pair Plugin Tests
 */

import { describe, it, expect } from "vitest";
import {
  ASCII_PAIRS,
  CJK_PAIRS,
  CJK_BRACKET_PAIRS,
  CJK_CURLY_QUOTE_PAIRS,
  getClosingChar,
  isClosingChar,
  getOpeningChar,
  SMART_QUOTE_CHARS,
} from "./pairs";

describe("Auto-Pair Pairs", () => {
  describe("ASCII_PAIRS", () => {
    it("should have all standard pairs", () => {
      expect(ASCII_PAIRS["("]).toBe(")");
      expect(ASCII_PAIRS["["]).toBe("]");
      expect(ASCII_PAIRS["{"]).toBe("}");
      expect(ASCII_PAIRS['"']).toBe('"');
      expect(ASCII_PAIRS["'"]).toBe("'");
      expect(ASCII_PAIRS["`"]).toBe("`");
    });
  });

  describe("CJK_PAIRS", () => {
    it("should have fullwidth parentheses", () => {
      expect(CJK_PAIRS["（"]).toBe("）");
    });

    it("should have lenticular brackets", () => {
      expect(CJK_PAIRS["【"]).toBe("】");
    });

    it("should have corner brackets", () => {
      expect(CJK_PAIRS["「"]).toBe("」");
    });

    it("should have white corner brackets", () => {
      expect(CJK_PAIRS["『"]).toBe("』");
    });

    it("should have double angle brackets", () => {
      expect(CJK_PAIRS["《"]).toBe("》");
    });

    it("should have angle brackets", () => {
      expect(CJK_PAIRS["〈"]).toBe("〉");
    });

    it("should have curly quotes in combined CJK_PAIRS", () => {
      expect(CJK_PAIRS["\u201C"]).toBe("\u201D"); // " "
      expect(CJK_PAIRS["\u2018"]).toBe("\u2019"); // ' '
    });
  });

  describe("CJK_BRACKET_PAIRS", () => {
    it("should have all bracket pairs but not curly quotes", () => {
      expect(CJK_BRACKET_PAIRS["（"]).toBe("）");
      expect(CJK_BRACKET_PAIRS["「"]).toBe("」");
      expect(CJK_BRACKET_PAIRS["\u201C"]).toBeUndefined();
    });
  });

  describe("CJK_CURLY_QUOTE_PAIRS", () => {
    it("should have curly quote pairs", () => {
      expect(CJK_CURLY_QUOTE_PAIRS["\u201C"]).toBe("\u201D"); // " "
      expect(CJK_CURLY_QUOTE_PAIRS["\u2018"]).toBe("\u2019"); // ' '
    });
  });

  describe("getClosingChar", () => {
    it("should return closing char for ASCII pairs", () => {
      expect(getClosingChar("(", false)).toBe(")");
      expect(getClosingChar("[", false)).toBe("]");
      expect(getClosingChar("{", false)).toBe("}");
      expect(getClosingChar('"', false)).toBe('"');
      expect(getClosingChar("'", false)).toBe("'");
      expect(getClosingChar("`", false)).toBe("`");
    });

    it("should return null for CJK pairs when includeCJK is false", () => {
      expect(getClosingChar("（", false)).toBeNull();
      expect(getClosingChar("「", false)).toBeNull();
      expect(getClosingChar("【", false)).toBeNull();
    });

    it("should return closing char for CJK bracket pairs when includeCJK is true", () => {
      const config = { includeCJK: true, includeCurlyQuotes: false };
      expect(getClosingChar("（", config)).toBe("）");
      expect(getClosingChar("「", config)).toBe("」");
      expect(getClosingChar("【", config)).toBe("】");
      expect(getClosingChar("《", config)).toBe("》");
    });

    it("should return null for curly quotes when includeCurlyQuotes is false", () => {
      const config = { includeCJK: true, includeCurlyQuotes: false };
      expect(getClosingChar("\u201C", config)).toBeNull();
      expect(getClosingChar("\u2018", config)).toBeNull();
    });

    it("should return closing char for curly quotes when both flags are true", () => {
      const config = { includeCJK: true, includeCurlyQuotes: true };
      expect(getClosingChar("\u201C", config)).toBe("\u201D");
      expect(getClosingChar("\u2018", config)).toBe("\u2019");
    });

    it("should return null for non-pair characters", () => {
      expect(getClosingChar("a", false)).toBeNull();
      expect(getClosingChar("1", false)).toBeNull();
      expect(getClosingChar(")", false)).toBeNull();
    });
  });

  describe("isClosingChar", () => {
    it("should return true for ASCII closing chars", () => {
      expect(isClosingChar(")")).toBe(true);
      expect(isClosingChar("]")).toBe(true);
      expect(isClosingChar("}")).toBe(true);
      expect(isClosingChar('"')).toBe(true);
      expect(isClosingChar("'")).toBe(true);
      expect(isClosingChar("`")).toBe(true);
    });

    it("should return true for CJK closing chars", () => {
      expect(isClosingChar("）")).toBe(true);
      expect(isClosingChar("」")).toBe(true);
      expect(isClosingChar("】")).toBe(true);
      expect(isClosingChar("》")).toBe(true);
      expect(isClosingChar("〉")).toBe(true);
      expect(isClosingChar("\u201D")).toBe(true); // "
      expect(isClosingChar("\u2019")).toBe(true); // '
    });

    it("should return false for opening chars", () => {
      expect(isClosingChar("(")).toBe(false);
      expect(isClosingChar("[")).toBe(false);
      expect(isClosingChar("「")).toBe(false);
    });

    it("should return false for regular characters", () => {
      expect(isClosingChar("a")).toBe(false);
      expect(isClosingChar("1")).toBe(false);
    });
  });

  describe("getOpeningChar", () => {
    it("should return opening char for ASCII closing chars", () => {
      expect(getOpeningChar(")")).toBe("(");
      expect(getOpeningChar("]")).toBe("[");
      expect(getOpeningChar("}")).toBe("{");
    });

    it("should return opening char for CJK closing chars", () => {
      expect(getOpeningChar("）")).toBe("（");
      expect(getOpeningChar("」")).toBe("「");
      expect(getOpeningChar("】")).toBe("【");
      expect(getOpeningChar("》")).toBe("《");
      expect(getOpeningChar("\u201D")).toBe("\u201C"); // " → "
      expect(getOpeningChar("\u2019")).toBe("\u2018"); // ' → '
    });

    it("should return null for non-closing chars", () => {
      expect(getOpeningChar("(")).toBeNull();
      expect(getOpeningChar("a")).toBeNull();
    });
  });

  describe("SMART_QUOTE_CHARS", () => {
    it("should contain single quote", () => {
      expect(SMART_QUOTE_CHARS.has("'")).toBe(true);
    });

    it("should contain curly single quote", () => {
      expect(SMART_QUOTE_CHARS.has("\u2018")).toBe(true);
    });

    it("should not contain double quote", () => {
      expect(SMART_QUOTE_CHARS.has('"')).toBe(false);
    });
  });
});
