/**
 * Tests for auto-pair character definitions and lookup functions.
 */

import { describe, it, expect } from "vitest";
import {
  ASCII_PAIRS,
  CJK_BRACKET_PAIRS,
  CJK_CURLY_QUOTE_PAIRS,
  CLOSING_CHARS,
  getClosingChar,
  isOpeningChar,
  isClosingChar,
  getOpeningChar,
  normalizeForPairing,
  straightToCurlyOpening,
  straightToCurlyClosing,
} from "./pairs";

describe("ASCII_PAIRS", () => {
  it("contains parentheses pair", () => {
    expect(ASCII_PAIRS["("]).toBe(")");
  });

  it("contains square brackets pair", () => {
    expect(ASCII_PAIRS["["]).toBe("]");
  });

  it("contains curly braces pair", () => {
    expect(ASCII_PAIRS["{"]).toBe("}");
  });

  it("contains double quote pair (symmetric)", () => {
    expect(ASCII_PAIRS['"']).toBe('"');
  });

  it("contains single quote pair (symmetric)", () => {
    expect(ASCII_PAIRS["'"]).toBe("'");
  });

  it("contains backtick pair (symmetric)", () => {
    expect(ASCII_PAIRS["`"]).toBe("`");
  });
});

describe("CJK_BRACKET_PAIRS", () => {
  it("contains fullwidth parentheses", () => {
    expect(CJK_BRACKET_PAIRS["（"]).toBe("）");
  });

  it("contains lenticular brackets", () => {
    expect(CJK_BRACKET_PAIRS["【"]).toBe("】");
  });

  it("contains corner brackets", () => {
    expect(CJK_BRACKET_PAIRS["「"]).toBe("」");
  });

  it("contains white corner brackets", () => {
    expect(CJK_BRACKET_PAIRS["『"]).toBe("』");
  });

  it("contains double angle brackets", () => {
    expect(CJK_BRACKET_PAIRS["《"]).toBe("》");
  });

  it("contains angle brackets", () => {
    expect(CJK_BRACKET_PAIRS["〈"]).toBe("〉");
  });
});

describe("CJK_CURLY_QUOTE_PAIRS", () => {
  it("contains curly double quotes", () => {
    expect(CJK_CURLY_QUOTE_PAIRS["\u201C"]).toBe("\u201D"); // " to "
  });

  it("contains curly single quotes", () => {
    expect(CJK_CURLY_QUOTE_PAIRS["\u2018"]).toBe("\u2019"); // ' to '
  });
});

describe("CLOSING_CHARS", () => {
  it("includes ASCII closing brackets", () => {
    expect(CLOSING_CHARS.has(")")).toBe(true);
    expect(CLOSING_CHARS.has("]")).toBe(true);
    expect(CLOSING_CHARS.has("}")).toBe(true);
  });

  it("includes symmetric quote chars", () => {
    expect(CLOSING_CHARS.has('"')).toBe(true);
    expect(CLOSING_CHARS.has("'")).toBe(true);
    expect(CLOSING_CHARS.has("`")).toBe(true);
  });

  it("includes CJK closing brackets", () => {
    expect(CLOSING_CHARS.has("）")).toBe(true);
    expect(CLOSING_CHARS.has("】")).toBe(true);
    expect(CLOSING_CHARS.has("」")).toBe(true);
  });

  it("includes CJK closing quotes", () => {
    expect(CLOSING_CHARS.has("\u201D")).toBe(true); // "
    expect(CLOSING_CHARS.has("\u2019")).toBe(true); // '
  });
});

describe("getClosingChar", () => {
  describe("with ASCII pairs", () => {
    it("returns closing bracket for opening bracket", () => {
      expect(getClosingChar("(", false)).toBe(")");
      expect(getClosingChar("[", false)).toBe("]");
      expect(getClosingChar("{", false)).toBe("}");
    });

    it("returns closing quote for opening quote", () => {
      expect(getClosingChar('"', false)).toBe('"');
      expect(getClosingChar("'", false)).toBe("'");
      expect(getClosingChar("`", false)).toBe("`");
    });

    it("returns null for non-opening characters", () => {
      expect(getClosingChar("a", false)).toBe(null);
      expect(getClosingChar(")", false)).toBe(null);
    });
  });

  describe("with CJK config", () => {
    it("returns CJK closing when CJK enabled", () => {
      expect(getClosingChar("（", { includeCJK: true, includeCurlyQuotes: false })).toBe("）");
      expect(getClosingChar("【", { includeCJK: true, includeCurlyQuotes: false })).toBe("】");
    });

    it("returns null for CJK when CJK disabled", () => {
      expect(getClosingChar("（", { includeCJK: false, includeCurlyQuotes: false })).toBe(null);
    });

    it("returns curly quotes only when both flags enabled", () => {
      expect(getClosingChar("\u201C", { includeCJK: true, includeCurlyQuotes: true })).toBe("\u201D");
      expect(getClosingChar("\u201C", { includeCJK: true, includeCurlyQuotes: false })).toBe(null);
      expect(getClosingChar("\u201C", { includeCJK: false, includeCurlyQuotes: true })).toBe(null);
    });
  });

  describe("legacy boolean API", () => {
    it("includes all CJK when true", () => {
      expect(getClosingChar("（", true)).toBe("）");
      expect(getClosingChar("\u201C", true)).toBe("\u201D");
    });
  });
});

describe("isOpeningChar", () => {
  it("returns true for ASCII opening brackets", () => {
    expect(isOpeningChar("(", false)).toBe(true);
    expect(isOpeningChar("[", false)).toBe(true);
    expect(isOpeningChar("{", false)).toBe(true);
  });

  it("returns true for ASCII quotes", () => {
    expect(isOpeningChar('"', false)).toBe(true);
    expect(isOpeningChar("'", false)).toBe(true);
  });

  it("returns false for closing brackets", () => {
    expect(isOpeningChar(")", false)).toBe(false);
    expect(isOpeningChar("]", false)).toBe(false);
  });

  it("respects CJK config", () => {
    expect(isOpeningChar("（", { includeCJK: true, includeCurlyQuotes: false })).toBe(true);
    expect(isOpeningChar("（", { includeCJK: false, includeCurlyQuotes: false })).toBe(false);
  });
});

describe("isClosingChar", () => {
  it("returns true for ASCII closing brackets", () => {
    expect(isClosingChar(")")).toBe(true);
    expect(isClosingChar("]")).toBe(true);
    expect(isClosingChar("}")).toBe(true);
  });

  it("returns true for CJK closing brackets", () => {
    expect(isClosingChar("）")).toBe(true);
    expect(isClosingChar("】")).toBe(true);
  });

  it("returns true for symmetric quotes (they are both opening and closing)", () => {
    expect(isClosingChar('"')).toBe(true);
    expect(isClosingChar("'")).toBe(true);
  });

  it("returns false for opening-only brackets", () => {
    expect(isClosingChar("(")).toBe(false);
    expect(isClosingChar("[")).toBe(false);
    expect(isClosingChar("（")).toBe(false);
  });

  it("returns false for regular characters", () => {
    expect(isClosingChar("a")).toBe(false);
    expect(isClosingChar("1")).toBe(false);
  });
});

describe("getOpeningChar", () => {
  it("returns opening for ASCII closing brackets", () => {
    expect(getOpeningChar(")")).toBe("(");
    expect(getOpeningChar("]")).toBe("[");
    expect(getOpeningChar("}")).toBe("{");
  });

  it("returns opening for CJK closing brackets", () => {
    expect(getOpeningChar("）")).toBe("（");
    expect(getOpeningChar("】")).toBe("【");
    expect(getOpeningChar("」")).toBe("「");
  });

  it("returns opening for curly quotes", () => {
    expect(getOpeningChar("\u201D")).toBe("\u201C"); // " -> "
    expect(getOpeningChar("\u2019")).toBe("\u2018"); // ' -> '
  });

  it("returns first match for symmetric pairs", () => {
    // For symmetric pairs like " ", the opening equals closing
    expect(getOpeningChar('"')).toBe('"');
    expect(getOpeningChar("'")).toBe("'");
  });

  it("returns null for non-closing characters", () => {
    expect(getOpeningChar("a")).toBe(null);
    expect(getOpeningChar("(")).toBe(null);
  });
});

describe("normalizeForPairing", () => {
  it("normalizes right double curly to left double curly", () => {
    expect(normalizeForPairing("\u201D")).toBe("\u201C"); // " → "
  });

  it("does NOT normalize right single curly (apostrophe)", () => {
    expect(normalizeForPairing("\u2019")).toBe("\u2019"); // ' stays '
  });

  it("passes through left double curly unchanged", () => {
    expect(normalizeForPairing("\u201C")).toBe("\u201C");
  });

  it("passes through left single curly unchanged", () => {
    expect(normalizeForPairing("\u2018")).toBe("\u2018");
  });

  it("passes through regular characters unchanged", () => {
    expect(normalizeForPairing("a")).toBe("a");
    expect(normalizeForPairing("(")).toBe("(");
    expect(normalizeForPairing('"')).toBe('"');
  });
});

describe("straightToCurlyOpening", () => {
  const ON = { includeCJK: true, includeCurlyQuotes: true };
  const OFF_CJK = { includeCJK: false, includeCurlyQuotes: true };
  const OFF_CURLY = { includeCJK: true, includeCurlyQuotes: false };

  it("converts straight double quote to curly opening when enabled", () => {
    expect(straightToCurlyOpening('"', ON)).toBe("\u201C");
  });

  it("converts straight single quote to curly opening when enabled", () => {
    expect(straightToCurlyOpening("'", ON)).toBe("\u2018");
  });

  it("passes through when CJK disabled", () => {
    expect(straightToCurlyOpening('"', OFF_CJK)).toBe('"');
  });

  it("passes through when curly quotes disabled", () => {
    expect(straightToCurlyOpening('"', OFF_CURLY)).toBe('"');
  });

  it("passes through non-quote characters", () => {
    expect(straightToCurlyOpening("(", ON)).toBe("(");
    expect(straightToCurlyOpening("a", ON)).toBe("a");
  });

  it("passes through already-curly quotes unchanged", () => {
    expect(straightToCurlyOpening("\u201C", ON)).toBe("\u201C");
    expect(straightToCurlyOpening("\u2018", ON)).toBe("\u2018");
  });
});

describe("straightToCurlyClosing", () => {
  const ON = { includeCJK: true, includeCurlyQuotes: true };
  const OFF_CJK = { includeCJK: false, includeCurlyQuotes: true };

  it("converts straight double quote to curly closing when enabled", () => {
    expect(straightToCurlyClosing('"', ON)).toBe("\u201D");
  });

  it("converts straight single quote to curly closing when enabled", () => {
    expect(straightToCurlyClosing("'", ON)).toBe("\u2019");
  });

  it("passes through when CJK disabled", () => {
    expect(straightToCurlyClosing('"', OFF_CJK)).toBe('"');
  });

  it("passes through non-quote characters", () => {
    expect(straightToCurlyClosing(")", ON)).toBe(")");
    expect(straightToCurlyClosing("a", ON)).toBe("a");
  });
});
