// @vitest-environment node
import { describe, it, expect } from "vitest";
import { escapeRegExp, countMatches } from "./sourceEditorSearch";

describe("escapeRegExp", () => {
  it("returns empty string unchanged", () => {
    expect(escapeRegExp("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeRegExp("hello world")).toBe("hello world");
  });

  it("escapes dot", () => {
    expect(escapeRegExp("file.txt")).toBe("file\\.txt");
  });

  it("escapes all special regex characters", () => {
    const specials = ".*+?^${}()|[]\\";
    const escaped = escapeRegExp(specials);
    expect(escaped).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("escapes special characters mixed with normal text", () => {
    expect(escapeRegExp("price: $100 (USD)")).toBe(
      "price: \\$100 \\(USD\\)"
    );
  });

  it("escapes pipe character", () => {
    expect(escapeRegExp("a|b")).toBe("a\\|b");
  });

  it("handles string with only special characters", () => {
    expect(escapeRegExp("^$")).toBe("\\^\\$");
  });
});

describe("countMatches", () => {
  // --- Empty / no-match cases ---

  it("returns 0 for empty query", () => {
    expect(countMatches("hello world", "", false, false, false)).toBe(0);
  });

  it("returns 0 when text has no matches", () => {
    expect(countMatches("hello world", "xyz", false, false, false)).toBe(0);
  });

  it("returns 0 for empty text with non-empty query", () => {
    expect(countMatches("", "hello", false, false, false)).toBe(0);
  });

  it("returns 0 for both empty text and query", () => {
    expect(countMatches("", "", false, false, false)).toBe(0);
  });

  // --- Basic matching ---

  it("counts single match", () => {
    expect(countMatches("hello world", "hello", false, false, false)).toBe(1);
  });

  it("counts multiple matches", () => {
    expect(countMatches("abcabc", "abc", false, false, false)).toBe(2);
  });

  it("counts overlapping occurrences as non-overlapping (regex exec behavior)", () => {
    // "aaa" searching for "aa" finds 1 match (positions 0-1), then continues at index 2
    expect(countMatches("aaa", "aa", false, false, false)).toBe(1);
  });

  // --- Case sensitivity ---

  it("matches case-insensitively by default", () => {
    expect(countMatches("Hello HELLO hello", "hello", false, false, false)).toBe(3);
  });

  it("respects case-sensitive flag", () => {
    expect(countMatches("Hello HELLO hello", "hello", true, false, false)).toBe(1);
  });

  it("case-sensitive matches exact case only", () => {
    expect(countMatches("Hello HELLO hello", "HELLO", true, false, false)).toBe(1);
  });

  // --- Whole word ---

  it("matches whole word only", () => {
    expect(countMatches("cat concatenate category", "cat", false, true, false)).toBe(1);
  });

  it("whole word matches multiple occurrences", () => {
    expect(
      countMatches("the cat sat on the mat with the cat", "cat", false, true, false)
    ).toBe(2);
  });

  it("whole word with case sensitivity", () => {
    expect(countMatches("Cat cat CAT", "cat", true, true, false)).toBe(1);
  });

  it("whole word returns 0 when only partial matches exist", () => {
    expect(countMatches("caterpillar", "cat", false, true, false)).toBe(0);
  });

  // --- Regex mode ---

  it("uses regex pattern when useRegex is true", () => {
    expect(countMatches("abc 123 def 456", "\\d+", false, false, true)).toBe(2);
  });

  it("regex mode ignores wholeWord flag", () => {
    // wholeWord is true but in regex mode it should be ignored
    expect(countMatches("abc 123 def 456", "\\d+", false, true, true)).toBe(2);
  });

  it("regex mode respects case sensitivity", () => {
    expect(countMatches("Abc abc ABC", "abc", true, false, true)).toBe(1);
  });

  it("regex mode case-insensitive", () => {
    expect(countMatches("Abc abc ABC", "abc", false, false, true)).toBe(3);
  });

  it("returns 0 for invalid regex", () => {
    expect(countMatches("hello world", "[invalid", false, false, true)).toBe(0);
  });

  it("returns 0 for another invalid regex pattern", () => {
    expect(countMatches("test", "(unclosed", false, false, true)).toBe(0);
  });

  it("handles zero-length regex matches without infinite loop", () => {
    // Pattern that matches empty string — should not loop forever
    expect(countMatches("abc", "", false, false, false)).toBe(0); // empty query short-circuits
  });

  it("handles zero-length regex match (lookahead)", () => {
    // (?=a) is a zero-length match before each 'a'
    const count = countMatches("aaa", "(?=a)", false, false, true);
    expect(count).toBe(3);
  });

  // --- Special characters in non-regex mode ---

  it("escapes special regex chars in literal mode", () => {
    expect(countMatches("price is $100", "$100", false, false, false)).toBe(1);
  });

  it("escapes dots in literal mode", () => {
    expect(countMatches("file.txt and filetxt", "file.txt", false, false, false)).toBe(1);
  });

  it("literal mode with parentheses", () => {
    expect(countMatches("func() and func()", "func()", false, false, false)).toBe(2);
  });

  // --- Unicode / CJK ---

  it("matches CJK characters", () => {
    expect(countMatches("你好世界你好", "你好", false, false, false)).toBe(2);
  });

  it("matches emoji", () => {
    expect(countMatches("hello 🎉 world 🎉", "🎉", false, false, false)).toBe(2);
  });

  // --- Multiline ---

  it("counts matches across multiple lines", () => {
    const text = "line one\nline two\nline three";
    expect(countMatches(text, "line", false, false, false)).toBe(3);
  });

  it("regex dot does not match newline by default", () => {
    const text = "abc\ndef";
    // . does not match \n without s flag
    expect(countMatches(text, "abc.def", false, false, true)).toBe(0);
  });

  // --- Boundary cases ---

  it("query longer than text returns 0", () => {
    expect(countMatches("hi", "hello world", false, false, false)).toBe(0);
  });

  it("query equal to text returns 1", () => {
    expect(countMatches("exact", "exact", false, false, false)).toBe(1);
  });

  it("handles text with only whitespace", () => {
    expect(countMatches("   ", " ", false, false, false)).toBe(3);
  });
});
