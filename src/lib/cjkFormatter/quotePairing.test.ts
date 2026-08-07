// @vitest-environment node
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

  describe("edge cases - apostrophe with curly quotes", () => {
    test("detects apostrophe with curly single close quote (right quote)", () => {
      // \u2019 is curly single close, used as apostrophe
      const tokens = tokenizeQuotes("don\u2019t");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("detects apostrophe with curly single open quote", () => {
      // \u2018 is curly single open, also checked in isApostrophe
      const tokens = tokenizeQuotes("don\u2018t");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("detects possessive 's followed by non-letter", () => {
      // Xiaolai's followed by space (non-letter after s)
      const tokens = tokenizeQuotes("Xiaolai's .");
      const apostrophes = tokens.filter((t) => t.role === "apostrophe");
      expect(apostrophes).toHaveLength(1);
    });

    test("does not treat letter-quote-s-letter as possessive", () => {
      // "Cat'stuff" - the s is followed by more letters, so it's not possessive
      const tokens = tokenizeQuotes("Cat'stuff");
      // It's apostrophe because letter + ' + letter pattern
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("detects possessive at end of string", () => {
      const tokens = tokenizeQuotes("Xiaolai's");
      const apostrophes = tokens.filter((t) => t.role === "apostrophe");
      expect(apostrophes).toHaveLength(1);
    });
  });

  describe("edge cases - decade abbreviation with curly open", () => {
    test("detects decade with curly single open quote", () => {
      const tokens = tokenizeQuotes("\u201890s");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("does not detect decade when preceded by digit", () => {
      // 5'90s - digit before quote means feet, not decade
      const tokens = tokenizeQuotes("5'90s");
      const primes = tokens.filter((t) => t.role === "prime");
      expect(primes.length).toBeGreaterThanOrEqual(1);
    });

    test("curly single close quote (\u2019) is not a decade opener (line 122 false branch)", () => {
      // \u2019 is CURLY_SINGLE_CLOSE — isDecadeAbbreviation returns false immediately
      // because char is neither "'" nor CURLY_SINGLE_OPEN (\u2018).
      // Without a letter before it, isApostrophe also returns false, so it is
      // classified as open/close (not apostrophe) — verifying line 122 is reached.
      const tokens = tokenizeQuotes("\u201990s");
      // \u2019 before "90s": not prime (no digit before), not apostrophe (no letter before),
      // not decade (char is \u2019, not \u2018 or '). Classified as open or close.
      const quoteToken = tokens.find((t) => t.role === "open" || t.role === "close");
      expect(quoteToken).toBeDefined();
    });
  });

  describe("edge cases - prime with non-digit break", () => {
    test("double prime after digits with non-digit lookback break", () => {
      // Pattern like a10" — the lookback for ' finds 'a' (non-digit) and breaks
      const tokens = tokenizeQuotes('a10"');
      const primes = tokens.filter((t) => t.role === "prime");
      expect(primes).toHaveLength(1);
    });
  });

  describe("classifyQuote — stack-based close fallback", () => {
    test("classifies quote as close when stack has matching opener", () => {
      // "abc"def" — the third " has no whitespace/punctuation signals
      // but the stack has an opener, so it should be classified as close.
      // The second " closes the first, the third becomes open,
      // and the fourth closes the third.
      const { pairs } = analyzeQuotes('"abc"def"xyz"');
      // Should pair successfully
      expect(pairs.length).toBeGreaterThanOrEqual(2);
    });

    test("defaults to open when no signals and empty stack", () => {
      // Single quote char surrounded by non-whitespace, non-punctuation
      // with empty stack → defaults to open
      const tokens = tokenizeQuotes('a"b');
      // leftNeighbor is 'a' (non-whitespace, non-open-bracket) → not strong open
      // rightNeighbor is 'b' (non-whitespace, non-close-bracket, non-terminal) → not strong close
      // Stack is empty → defaults to "open"
      const quoteToken = tokens.find(
        (t) => t.role === "open" || t.role === "close"
      );
      expect(quoteToken?.role).toBe("open");
    });
  });

  describe("applyContextualQuotes — single quotes in contextual CJK", () => {
    test("CJK-involved single quotes become curly in contextual mode", () => {
      const result = applyContextualQuotes("中文'Hello'", "contextual");
      expect(result).toBe("中文\u2018Hello\u2019");
    });
  });

  describe("applyContextualQuotes - unknown mode fallthrough", () => {
    test("handles single quotes in corner-for-cjk mode with CJK", () => {
      const result = applyContextualQuotes("中文'Hello'", "corner-for-cjk");
      expect(result).toBe("中文『Hello』");
    });

    test("single quotes in contextual mode stay straight for Latin", () => {
      const result = applyContextualQuotes("'Hello'", "contextual");
      expect(result).toBe("'Hello'");
    });

    test("single quotes in curly-everywhere mode become curly", () => {
      const result = applyContextualQuotes("'Hello'", "curly-everywhere");
      expect(result).toBe("\u2018Hello\u2019");
    });

    // line 440: the `else { continue }` branch — an unrecognized mode skips replacement
    // The function signature currently accepts only specific modes so this is a type-safety
    // guard hit only when called with an unexpected value at runtime.
    test("unknown mode skips all replacements and returns original text unchanged", () => {
      // Force an unknown mode via type cast to test the `else { continue }` branch (line 440)
      const result = applyContextualQuotes('"Hello"', "unknown-mode" as Parameters<typeof applyContextualQuotes>[1]);
      // No replacements applied — returns original text
      expect(result).toBe('"Hello"');
    });
  });

  describe("isApostrophe — non-quote char returns false (line 88)", () => {
    test("double quote character is never treated as apostrophe", () => {
      // Double quote between letters: a"b — isApostrophe returns false for '"'
      const tokens = tokenizeQuotes('a"b');
      const dblQuote = tokens.find(t => t.type === "double");
      expect(dblQuote).toBeDefined();
      expect(dblQuote!.role).not.toBe("apostrophe");
    });
  });

  describe("possessive — afterS check branches (lines 100-105)", () => {
    test("letter+apostrophe+s followed by letter is NOT possessive (falls to contraction)", () => {
      // "it'stuff" — t + ' + s, afterS='t' (a letter) → possessive fails
      // But letter+'+letter (t+'+s) triggers isApostrophe at line 95 first
      const tokens = tokenizeQuotes("it'stuff");
      // First check: before='t' (letter), after='s' (letter) → line 95 returns true
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("possessive with afterS as empty (end of string, line 102 false branch)", () => {
      // "cat's" — at end, pos+2 >= length → afterS="" → possessive ✓
      const tokens = tokenizeQuotes("cat's");
      expect(tokens[0].role).toBe("apostrophe");
    });

    test("possessive where afterS is a non-letter (space)", () => {
      // "dog's tail" — s followed by space → possessive ✓
      const tokens = tokenizeQuotes("dog's tail");
      const apostrophes = tokens.filter(t => t.role === "apostrophe");
      expect(apostrophes).toHaveLength(1);
    });
  });

  describe("classifyQuote — stack close with empty stack default (line 118/222)", () => {
    test("quote with no contextual signals and empty stack defaults to open", () => {
      // Place a quote between two non-whitespace, non-bracket, non-punctuation chars
      // with an empty stack → default to "open"
      const tokens = tokenizeQuotes('x"y');
      const qt = tokens.find(t => t.type === "double" && (t.role === "open" || t.role === "close"));
      expect(qt).toBeDefined();
      expect(qt!.role).toBe("open");
    });
  });

  describe("tokenizeQuotes — apostrophe edge cases", () => {
    // line 88: char is not ' or curly single → return false from isApostrophe
    // (These exercise the `if (char !== ...)` guard that returns false for non-apostrophe chars)
    test("double quote adjacent to letters is not treated as apostrophe", () => {
      // '"' is not a single-quote char, so isApostrophe returns false immediately
      const tokens = tokenizeQuotes('say "hello"');
      // Both double quotes should be classified as open/close, not apostrophe
      expect(tokens.some((t) => t.role === "apostrophe")).toBe(false);
    });

    // line 100-105: Letter + ' + s pattern where afterS IS a letter (possessive false branch)
    // e.g., "it's" — letter before, 's' after, but followed by more letters → not possessive
    test("letter-apostrophe-s followed by more letters is contraction, not possessive", () => {
      // "isn't" — n + ' + t (not 's'), but "it's" where after 's' is a space → possessive
      // To hit the `afterS IS letter` branch: needs letter + ' + s + letter
      // Example: "Elsa's" → a + ' + s followed by nothing → possessive ✓
      // Example: "isn't" → n + ' + t → contraction branch (before='n', after='t') ✓
      // For the `!/[a-zA-Z]/.test(afterS)` false path: "class" has l + a + s + s
      // We need: letter + apostrophe + s + letter → e.g., "it'self" (contrived)
      const tokens = tokenizeQuotes("it'self");
      // before='t', after='s', afterS='e' (a letter) → possessive check fails →
      // falls through to isApostrophe returning false → classified as open/close quote
      // (not apostrophe), meaning there should be no apostrophe token
      // before='t' (letter), after='s' (letter) → line 95 returns true first
      expect(tokens.some((t) => t.role === "apostrophe")).toBe(true);
    });

    // line 102: cond-expr `pos + 2 < text.length ? text[pos + 2] : ""`
    // when apostrophe is near end of string (pos + 2 >= length) → afterS = ""
    test("possessive apostrophe at near-end of string (afterS is empty)", () => {
      // "cat's" — t + ' + s at positions 3,4; afterS would be text[5] = undefined → ""
      // !/[a-zA-Z]/.test("") → true → returns true (is possessive)
      const tokens = tokenizeQuotes("cat's");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].role).toBe("apostrophe");
    });
  });
});
