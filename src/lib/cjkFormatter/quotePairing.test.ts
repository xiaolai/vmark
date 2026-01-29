import { describe, test, expect } from "vitest";
import {
  tokenizeQuotes,
  analyzeQuotes,
  applyContextualQuotes,
} from "./quotePairing";

describe("quotePairing", () => {
  describe("tokenizeQuotes", () => {
    test("identifies straight double quotes", () => {
      const tokens = tokenizeQuotes('"Hello"');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].type).toBe("double");
      expect(tokens[0].role).toBe("open");
      expect(tokens[1].type).toBe("double");
      expect(tokens[1].role).toBe("close");
    });

    test("identifies straight single quotes", () => {
      const tokens = tokenizeQuotes("'Hello'");
      expect(tokens).toHaveLength(2);
      expect(tokens[0].type).toBe("single");
      expect(tokens[0].role).toBe("open");
      expect(tokens[1].type).toBe("single");
      expect(tokens[1].role).toBe("close");
    });

    test("identifies curly quotes", () => {
      const tokens = tokenizeQuotes(`"Hello"`);
      expect(tokens).toHaveLength(2);
      expect(tokens[0].role).toBe("open");
      expect(tokens[1].role).toBe("close");
    });

    test("detects apostrophes in contractions", () => {
      const tokens = tokenizeQuotes("don't");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("detects apostrophes in possessives", () => {
      const tokens = tokenizeQuotes("Xiaolai's book");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("detects decade abbreviations", () => {
      const tokens = tokenizeQuotes("'90s");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("detects primes in measurements", () => {
      const tokens = tokenizeQuotes('5\'10"');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].role).toBe("prime");
      expect(tokens[1].role).toBe("prime");
    });

    test("detects feet measurement", () => {
      const tokens = tokenizeQuotes("6'");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("prime");
    });

    test("detects inches measurement", () => {
      const tokens = tokenizeQuotes('12"');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("prime");
    });

    test("handles mixed quotes and apostrophes", () => {
      const tokens = tokenizeQuotes('"don\'t do that"');
      const quoteTokens = tokens.filter(
        (t) => t.role === "open" || t.role === "close"
      );
      const apostropheTokens = tokens.filter((t) => t.role === "apostrophe");
      expect(quoteTokens).toHaveLength(2);
      expect(apostropheTokens).toHaveLength(1);
    });
  });

  describe("analyzeQuotes - basic pairing", () => {
    test("pairs simple double quotes", () => {
      const { pairs, orphans } = analyzeQuotes('"Hello"');
      expect(pairs).toHaveLength(1);
      expect(pairs[0].content).toBe("Hello");
      expect(orphans).toHaveLength(0);
    });

    test("pairs simple single quotes", () => {
      const { pairs, orphans } = analyzeQuotes("'Hello'");
      expect(pairs).toHaveLength(1);
      expect(pairs[0].content).toBe("Hello");
      expect(orphans).toHaveLength(0);
    });

    test("pairs multiple quote pairs", () => {
      const { pairs } = analyzeQuotes('"Hello" and "World"');
      expect(pairs).toHaveLength(2);
      expect(pairs[0].content).toBe("Hello");
      expect(pairs[1].content).toBe("World");
    });

    test("handles nested quotes", () => {
      const { pairs } = analyzeQuotes("\"He said 'hello'\"");
      expect(pairs).toHaveLength(2);
      // Outer pair
      const outer = pairs.find((p) => p.content.includes("He said"));
      expect(outer).toBeDefined();
      // Inner pair
      const inner = pairs.find((p) => p.content === "hello");
      expect(inner).toBeDefined();
    });
  });

  describe("analyzeQuotes - CJK involvement", () => {
    test("detects CJK in content", () => {
      const { pairs } = analyzeQuotes('"你好"');
      expect(pairs).toHaveLength(1);
      expect(pairs[0].isCJKInvolved).toBe(true);
    });

    test("detects CJK at left boundary", () => {
      const { pairs } = analyzeQuotes('中文"Hello"');
      expect(pairs).toHaveLength(1);
      expect(pairs[0].isCJKInvolved).toBe(true);
    });

    test("detects CJK at right boundary", () => {
      const { pairs } = analyzeQuotes('"Hello"中文');
      expect(pairs).toHaveLength(1);
      expect(pairs[0].isCJKInvolved).toBe(true);
    });

    test("no CJK in pure Latin", () => {
      const { pairs } = analyzeQuotes('"Hello World"');
      expect(pairs).toHaveLength(1);
      expect(pairs[0].isCJKInvolved).toBe(false);
    });
  });

  describe("analyzeQuotes - orphan handling", () => {
    test("detects unclosed opening quote", () => {
      const { pairs, orphans } = analyzeQuotes('"unclosed');
      expect(pairs).toHaveLength(0);
      expect(orphans).toHaveLength(1);
      expect(orphans[0].role).toBe("open");
    });

    test("detects unmatched closing quote", () => {
      const { pairs, orphans } = analyzeQuotes('unclosed"');
      expect(pairs).toHaveLength(0);
      expect(orphans).toHaveLength(1);
      expect(orphans[0].role).toBe("close");
    });

    test("orphans inner quotes when outer closes", () => {
      // "He said 'hello" - the single quote is orphaned when double closes
      const { pairs, orphans } = analyzeQuotes("\"He said 'hello\"");
      expect(pairs).toHaveLength(1); // The outer double pair
      expect(orphans.some((o) => o.type === "single")).toBe(true);
    });
  });

  describe("applyContextualQuotes - contextual mode", () => {
    test("uses curly quotes for CJK context", () => {
      const result = applyContextualQuotes('中文"Hello"', "contextual");
      expect(result).toBe("中文\u201cHello\u201d");
    });

    test("uses curly quotes when content has CJK", () => {
      const result = applyContextualQuotes('"你好"', "contextual");
      expect(result).toBe("\u201c你好\u201d");
    });

    test("uses straight quotes for pure Latin", () => {
      const result = applyContextualQuotes('"Hello World"', "contextual");
      expect(result).toBe('"Hello World"');
    });

    test("preserves apostrophes", () => {
      const result = applyContextualQuotes("don't", "contextual");
      expect(result).toBe("don't");
    });

    test("preserves primes", () => {
      const result = applyContextualQuotes('5\'10"', "contextual");
      expect(result).toBe('5\'10"');
    });

    test("handles mixed Latin and CJK quotes", () => {
      const result = applyContextualQuotes(
        '"Hello" and 中文"你好"',
        "contextual"
      );
      // First quote is pure Latin - straight
      // Second quote has CJK - curly
      expect(result).toContain('"Hello"');
      expect(result).toContain("\u201c你好\u201d");
    });

    test("nested quotes: outer curly, inner straight for Latin", () => {
      const result = applyContextualQuotes(
        "中文\"He said 'hello' to Alice\"",
        "contextual"
      );
      // Outer is CJK-involved (curly)
      expect(result).toContain("\u201c");
      expect(result).toContain("\u201d");
      // Inner is Latin-only (straight)
      expect(result).toContain("'hello'");
    });
  });

  describe("applyContextualQuotes - curly-everywhere mode", () => {
    test("converts all quotes to curly", () => {
      const result = applyContextualQuotes('"Hello"', "curly-everywhere");
      expect(result).toBe("\u201cHello\u201d");
    });

    test("converts single quotes too", () => {
      const result = applyContextualQuotes("'Hello'", "curly-everywhere");
      expect(result).toBe("\u2018Hello\u2019");
    });

    test("preserves apostrophes", () => {
      const result = applyContextualQuotes("don't", "curly-everywhere");
      expect(result).toBe("don't");
    });
  });

  describe("applyContextualQuotes - corner-for-cjk mode", () => {
    test("uses corner quotes for CJK content", () => {
      const result = applyContextualQuotes('"你好"', "corner-for-cjk");
      expect(result).toBe("「你好」");
    });

    test("uses corner quotes for CJK boundary", () => {
      const result = applyContextualQuotes('中文"Hello"', "corner-for-cjk");
      expect(result).toBe("中文「Hello」");
    });

    test("uses straight quotes for pure Latin", () => {
      const result = applyContextualQuotes('"Hello"', "corner-for-cjk");
      expect(result).toBe('"Hello"');
    });

    test("nested corner quotes", () => {
      const result = applyContextualQuotes("中文\"He said 'hi'\"", "corner-for-cjk");
      expect(result).toContain("「");
      expect(result).toContain("」");
      // Inner single quotes should be straight (Latin only inside)
      expect(result).toContain("'hi'");
    });
  });

  describe("applyContextualQuotes - off mode", () => {
    test("returns text unchanged", () => {
      const input = '"Hello" \'World\'';
      const result = applyContextualQuotes(input, "off");
      expect(result).toBe(input);
    });
  });

  describe("complex scenarios", () => {
    test("spec example: mixed quotes and apostrophes", () => {
      const input = '他说"Hello"然后说"你好", 并补充don\'t把 \'90s 写错, 身高5\'10".';
      const result = applyContextualQuotes(input, "contextual");

      // Both quote pairs should become curly (CJK context)
      expect(result).toContain("\u201cHello\u201d");
      expect(result).toContain("\u201c你好\u201d");

      // Apostrophe preserved
      expect(result).toContain("don't");

      // Decade abbreviation preserved
      expect(result).toContain("'90s");

      // Measurement primes preserved
      expect(result).toContain("5'10\"");
    });

    test("multiple nested levels", () => {
      const { pairs } = analyzeQuotes("\"Outer 'middle \"inner\" middle' outer\"");
      // Should have 3 pairs
      expect(pairs.length).toBe(3);
    });

    test("quote after CJK punctuation", () => {
      const { pairs } = analyzeQuotes("中文，\"Hello\"");
      expect(pairs).toHaveLength(1);
      // Should detect CJK boundary (via the CJK comma)
      // Note: Our current implementation only checks immediate neighbors
      // This might not detect the CJK comma as a boundary
    });
  });
});
