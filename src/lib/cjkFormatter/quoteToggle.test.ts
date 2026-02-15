/**
 * Tests for Quote Toggle — cycling quote styles at cursor position.
 *
 * IMPORTANT: All non-ASCII quote characters use Unicode escape sequences
 * to prevent LLM character substitution (Claude normalizes curly quotes
 * to straight quotes in generated text).
 */
import { describe, it, expect } from "vitest";
import {
  detectQuoteStyle,
  getNextQuoteStyle,
  computeQuoteToggle,
} from "./quoteToggle";
import type { QuoteStyleId } from "./quoteToggle";

// ============================================================================
// Character constants — ALWAYS Unicode escapes, never literal curly quotes
// ============================================================================

// Straight
const S_DQ = '"'; // U+0022
const S_SQ = "'"; // U+0027

// Curly
const C_DQ_O = "\u201c"; // left double quotation mark
const C_DQ_C = "\u201d"; // right double quotation mark
const C_SQ_O = "\u2018"; // left single quotation mark
const C_SQ_C = "\u2019"; // right single quotation mark

// Corner brackets
const K_DQ_O = "\u300c"; // left corner bracket (double)
const K_DQ_C = "\u300d"; // right corner bracket (double)
const K_SQ_O = "\u300e"; // left white corner bracket (single)
const K_SQ_C = "\u300f"; // right white corner bracket (single)

// Guillemets
const G_DQ_O = "\u00ab"; // left-pointing double angle quotation mark
const G_DQ_C = "\u00bb"; // right-pointing double angle quotation mark
const G_SQ_O = "\u2039"; // single left-pointing angle quotation mark
const G_SQ_C = "\u203a"; // single right-pointing angle quotation mark

// ============================================================================
// detectQuoteStyle
// ============================================================================

describe("detectQuoteStyle", () => {
  it.each<[string, QuoteStyleId]>([
    [S_DQ, "straight"],
    [S_SQ, "straight"],
    [C_DQ_O, "curly"],
    [C_DQ_C, "curly"],
    [C_SQ_O, "curly"],
    [C_SQ_C, "curly"],
    [K_DQ_O, "corner"],
    [K_DQ_C, "corner"],
    [K_SQ_O, "corner"],
    [K_SQ_C, "corner"],
    [G_DQ_O, "guillemets"],
    [G_DQ_C, "guillemets"],
    [G_SQ_O, "guillemets"],
    [G_SQ_C, "guillemets"],
  ])("detectQuoteStyle(%j) = %s", (char, expected) => {
    expect(detectQuoteStyle(char)).toBe(expected);
  });
});

// ============================================================================
// getNextQuoteStyle
// ============================================================================

describe("getNextQuoteStyle", () => {
  describe("simple mode", () => {
    it.each<[QuoteStyleId, QuoteStyleId]>([
      ["straight", "curly"],
      ["curly", "straight"],
      ["corner", "straight"],
      ["guillemets", "straight"],
    ])("%s -> %s (preferredStyle=curly)", (current, expected) => {
      expect(getNextQuoteStyle(current, "simple", "curly")).toBe(expected);
    });

    it("straight -> corner when preferredStyle=corner", () => {
      expect(getNextQuoteStyle("straight", "simple", "corner")).toBe("corner");
    });

    it("straight -> guillemets when preferredStyle=guillemets", () => {
      expect(getNextQuoteStyle("straight", "simple", "guillemets")).toBe("guillemets");
    });

    it("non-straight always goes to straight regardless of preferred", () => {
      expect(getNextQuoteStyle("curly", "simple", "corner")).toBe("straight");
      expect(getNextQuoteStyle("corner", "simple", "guillemets")).toBe("straight");
      expect(getNextQuoteStyle("guillemets", "simple", "curly")).toBe("straight");
    });
  });

  describe("full-cycle mode", () => {
    it.each<[QuoteStyleId, QuoteStyleId]>([
      ["straight", "curly"],
      ["curly", "corner"],
      ["corner", "guillemets"],
      ["guillemets", "straight"],
    ])("%s -> %s", (current, expected) => {
      // preferredStyle is ignored in full-cycle mode
      expect(getNextQuoteStyle(current, "full-cycle", "curly")).toBe(expected);
    });
  });
});

// ============================================================================
// computeQuoteToggle
// ============================================================================

describe("computeQuoteToggle", () => {
  describe("simple toggle: straight <-> curly", () => {
    it("straight double -> curly double", () => {
      // "hello" with cursor inside
      const text = `${S_DQ}hello${S_DQ}`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toHaveLength(2);
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: S_DQ, newChar: C_DQ_O });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: S_DQ, newChar: C_DQ_C });
    });

    it("curly double -> straight double", () => {
      const text = `${C_DQ_O}hello${C_DQ_C}`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: C_DQ_O, newChar: S_DQ });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: C_DQ_C, newChar: S_DQ });
    });

    it("straight single -> curly single", () => {
      const text = `${S_SQ}hello${S_SQ}`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: S_SQ, newChar: C_SQ_O });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: S_SQ, newChar: C_SQ_C });
    });

    it("curly single -> straight single", () => {
      const text = `${C_SQ_O}hello${C_SQ_C}`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: C_SQ_O, newChar: S_SQ });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: C_SQ_C, newChar: S_SQ });
    });
  });

  describe("simple toggle: non-straight -> straight", () => {
    it("corner double -> straight", () => {
      const text = `${K_DQ_O}hello${K_DQ_C}`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: K_DQ_O, newChar: S_DQ });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: K_DQ_C, newChar: S_DQ });
    });

    it("guillemets double -> straight", () => {
      const text = `${G_DQ_O}hello${G_DQ_C}`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: G_DQ_O, newChar: S_DQ });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: G_DQ_C, newChar: S_DQ });
    });

    it("corner single -> straight", () => {
      const text = `${K_SQ_O}hello${K_SQ_C}`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: K_SQ_O, newChar: S_SQ });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: K_SQ_C, newChar: S_SQ });
    });

    it("guillemets single -> straight", () => {
      const text = `${G_SQ_O}hello${G_SQ_C}`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: G_SQ_O, newChar: S_SQ });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: G_SQ_C, newChar: S_SQ });
    });
  });

  describe("simple toggle: preferred style variations", () => {
    it("straight -> corner when preferredStyle=corner", () => {
      const text = `${S_DQ}hello${S_DQ}`;
      const result = computeQuoteToggle(text, 3, "simple", "corner");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: S_DQ, newChar: K_DQ_O });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: S_DQ, newChar: K_DQ_C });
    });

    it("straight -> guillemets when preferredStyle=guillemets", () => {
      const text = `${S_DQ}hello${S_DQ}`;
      const result = computeQuoteToggle(text, 3, "simple", "guillemets");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: S_DQ, newChar: G_DQ_O });
      expect(result!.replacements).toContainEqual({ offset: 6, oldChar: S_DQ, newChar: G_DQ_C });
    });
  });

  describe("full-cycle mode", () => {
    it("straight -> curly -> corner -> guillemets -> straight (double)", () => {
      // Step 1: straight -> curly
      const t1 = `${S_DQ}hi${S_DQ}`;
      const r1 = computeQuoteToggle(t1, 1, "full-cycle", "curly");
      expect(r1).not.toBeNull();
      expect(r1!.replacements).toContainEqual({ offset: 0, oldChar: S_DQ, newChar: C_DQ_O });
      expect(r1!.replacements).toContainEqual({ offset: 3, oldChar: S_DQ, newChar: C_DQ_C });

      // Step 2: curly -> corner
      const t2 = `${C_DQ_O}hi${C_DQ_C}`;
      const r2 = computeQuoteToggle(t2, 1, "full-cycle", "curly");
      expect(r2).not.toBeNull();
      expect(r2!.replacements).toContainEqual({ offset: 0, oldChar: C_DQ_O, newChar: K_DQ_O });
      expect(r2!.replacements).toContainEqual({ offset: 3, oldChar: C_DQ_C, newChar: K_DQ_C });

      // Step 3: corner -> guillemets
      const t3 = `${K_DQ_O}hi${K_DQ_C}`;
      const r3 = computeQuoteToggle(t3, 1, "full-cycle", "curly");
      expect(r3).not.toBeNull();
      expect(r3!.replacements).toContainEqual({ offset: 0, oldChar: K_DQ_O, newChar: G_DQ_O });
      expect(r3!.replacements).toContainEqual({ offset: 3, oldChar: K_DQ_C, newChar: G_DQ_C });

      // Step 4: guillemets -> straight
      const t4 = `${G_DQ_O}hi${G_DQ_C}`;
      const r4 = computeQuoteToggle(t4, 1, "full-cycle", "curly");
      expect(r4).not.toBeNull();
      expect(r4!.replacements).toContainEqual({ offset: 0, oldChar: G_DQ_O, newChar: S_DQ });
      expect(r4!.replacements).toContainEqual({ offset: 3, oldChar: G_DQ_C, newChar: S_DQ });
    });

    it("full cycle works for single quotes too", () => {
      // straight -> curly
      const t1 = `${S_SQ}hi${S_SQ}`;
      const r1 = computeQuoteToggle(t1, 1, "full-cycle", "curly");
      expect(r1).not.toBeNull();
      expect(r1!.replacements).toContainEqual({ offset: 0, oldChar: S_SQ, newChar: C_SQ_O });

      // curly -> corner
      const t2 = `${C_SQ_O}hi${C_SQ_C}`;
      const r2 = computeQuoteToggle(t2, 1, "full-cycle", "curly");
      expect(r2).not.toBeNull();
      expect(r2!.replacements).toContainEqual({ offset: 0, oldChar: C_SQ_O, newChar: K_SQ_O });
    });
  });

  describe("nested quotes", () => {
    it("toggles innermost pair when cursor is in inner quotes", () => {
      // "She said 'hello' to me" — cursor inside 'hello'
      // Positions:  0         1         2
      //             0123456789012345678901234
      // " S h e   s a i d   ' h e l l o '   t o   m e "
      const text = `${S_DQ}She said ${S_SQ}hello${S_SQ} to me${S_DQ}`;
      // cursor at 'h' of 'hello' = position 11
      const result = computeQuoteToggle(text, 11, "simple", "curly");
      expect(result).not.toBeNull();
      // Should toggle the single quotes (inner pair), not the double quotes (outer)
      expect(result!.replacements).toHaveLength(2);
      // The inner single quotes should become curly single
      expect(result!.replacements).toContainEqual(
        expect.objectContaining({ oldChar: S_SQ, newChar: C_SQ_O })
      );
      expect(result!.replacements).toContainEqual(
        expect.objectContaining({ oldChar: S_SQ, newChar: C_SQ_C })
      );
    });

    it("toggles outer pair when cursor is outside inner quotes", () => {
      // "She said 'hello' to me" — cursor at 'S' (position 1)
      const text = `${S_DQ}She said ${S_SQ}hello${S_SQ} to me${S_DQ}`;
      const result = computeQuoteToggle(text, 1, "simple", "curly");
      expect(result).not.toBeNull();
      // Should toggle the double quotes (outer pair)
      expect(result!.replacements).toContainEqual(
        expect.objectContaining({ oldChar: S_DQ, newChar: C_DQ_O })
      );
      expect(result!.replacements).toContainEqual(
        expect.objectContaining({ oldChar: S_DQ, newChar: C_DQ_C })
      );
    });
  });

  describe("apostrophe exclusion", () => {
    it("returns null for cursor at apostrophe in don't", () => {
      const text = "don't";
      // cursor at apostrophe position 3
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).toBeNull();
    });

    it("returns null for cursor in word with apostrophe", () => {
      const text = "it's fine";
      // cursor at ' ' (position 4 — after the apostrophe word, no enclosing pair)
      const result = computeQuoteToggle(text, 4, "simple", "curly");
      expect(result).toBeNull();
    });
  });

  describe("prime exclusion", () => {
    it("returns null for cursor at prime in measurement", () => {
      // 5'10" — primes not quotes
      const text = "5'10\"";
      const result = computeQuoteToggle(text, 2, "simple", "curly");
      expect(result).toBeNull();
    });
  });

  describe("empty quotes", () => {
    it("toggles empty straight double quotes", () => {
      const text = `${S_DQ}${S_DQ}`;
      // cursor at position 1 (between the two quotes)
      const result = computeQuoteToggle(text, 1, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: S_DQ, newChar: C_DQ_O });
      expect(result!.replacements).toContainEqual({ offset: 1, oldChar: S_DQ, newChar: C_DQ_C });
    });

    it("toggles empty curly double quotes", () => {
      const text = `${C_DQ_O}${C_DQ_C}`;
      const result = computeQuoteToggle(text, 1, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: C_DQ_O, newChar: S_DQ });
      expect(result!.replacements).toContainEqual({ offset: 1, oldChar: C_DQ_C, newChar: S_DQ });
    });
  });

  describe("cursor boundary positions", () => {
    it("cursor ON opening quote is treated as inside", () => {
      const text = `${S_DQ}hello${S_DQ}`;
      const result = computeQuoteToggle(text, 0, "simple", "curly");
      expect(result).not.toBeNull();
    });

    it("cursor ON closing quote is treated as inside", () => {
      const text = `${S_DQ}hello${S_DQ}`;
      const result = computeQuoteToggle(text, 6, "simple", "curly");
      expect(result).not.toBeNull();
    });
  });

  describe("no enclosing pair", () => {
    it("returns null when cursor is not inside any quote pair", () => {
      const text = "hello world";
      const result = computeQuoteToggle(text, 5, "simple", "curly");
      expect(result).toBeNull();
    });

    it("returns null for orphan/unmatched quote", () => {
      const text = `${S_DQ}hello`;
      const result = computeQuoteToggle(text, 3, "simple", "curly");
      expect(result).toBeNull();
    });

    it("returns null when cursor is outside all pairs", () => {
      const text = `before ${S_DQ}hello${S_DQ} after`;
      // cursor at 'b' (position 0) — outside the quotes
      const result = computeQuoteToggle(text, 0, "simple", "curly");
      expect(result).toBeNull();
    });
  });

  describe("CJK content", () => {
    it("toggles straight quotes around CJK text", () => {
      const text = `${S_DQ}\u4f60\u597d${S_DQ}`; // "你好"
      const result = computeQuoteToggle(text, 1, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: S_DQ, newChar: C_DQ_O });
    });

    it("toggles corner brackets around CJK text to straight", () => {
      const text = `${K_DQ_O}\u4f60\u597d${K_DQ_C}`; // 「你好」
      const result = computeQuoteToggle(text, 1, "simple", "curly");
      expect(result).not.toBeNull();
      expect(result!.replacements).toContainEqual({ offset: 0, oldChar: K_DQ_O, newChar: S_DQ });
      expect(result!.replacements).toContainEqual({ offset: 3, oldChar: K_DQ_C, newChar: S_DQ });
    });
  });
});
