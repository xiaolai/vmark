import { describe, expect, it } from "vitest";
import {
  stripMarkdown,
  countWordsFromPlain,
  countCharsFromPlain,
  computeTextMetrics,
} from "./statusTextMetrics";

describe("stripMarkdown", () => {
  it("strips heading markers", () => {
    expect(stripMarkdown("# Hello")).toBe("Hello");
    expect(stripMarkdown("## Sub heading")).toBe("Sub heading");
    expect(stripMarkdown("###### Deep heading")).toBe("Deep heading");
  });

  it("strips bold markers", () => {
    expect(stripMarkdown("**bold text**")).toBe("bold text");
    expect(stripMarkdown("__bold text__")).toBe("bold text");
  });

  it("strips italic markers", () => {
    expect(stripMarkdown("*italic text*")).toBe("italic text");
    expect(stripMarkdown("_italic text_")).toBe("italic text");
  });

  it("strips inline code", () => {
    expect(stripMarkdown("use `const` here")).toBe("use  here");
  });

  it("strips fenced code blocks", () => {
    const input = "before\n```js\nconst x = 1;\n```\nafter";
    expect(stripMarkdown(input)).toBe("before\n\nafter");
  });

  it("strips image syntax", () => {
    expect(stripMarkdown("![alt text](image.png)")).toBe("");
  });

  it("strips link syntax but keeps label", () => {
    expect(stripMarkdown("[click here](https://example.com)")).toBe("click here");
  });

  it("strips blockquote markers", () => {
    expect(stripMarkdown("> quoted text")).toBe("quoted text");
  });

  it("strips horizontal rules", () => {
    expect(stripMarkdown("---")).toBe("");
    // Note: "***" and "___" are partially consumed by bold/italic stripping
    // before the HR regex runs — only "---" is a clean HR match.
    // This reflects the actual regex ordering in stripMarkdown.
    expect(stripMarkdown("---\ntext")).toBe("text");
  });

  it("strips unordered list markers", () => {
    expect(stripMarkdown("- item one\n- item two")).toBe("item one\nitem two");
    expect(stripMarkdown("* item one")).toBe("item one");
    expect(stripMarkdown("+ item one")).toBe("item one");
  });

  it("strips ordered list markers", () => {
    expect(stripMarkdown("1. first\n2. second")).toBe("first\nsecond");
  });

  it("collapses triple+ newlines", () => {
    expect(stripMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("trims whitespace", () => {
    expect(stripMarkdown("  hello  ")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(stripMarkdown("")).toBe("");
  });

  it("handles whitespace-only string", () => {
    expect(stripMarkdown("   \n\n  ")).toBe("");
  });

  it("handles combined markdown", () => {
    const input = "# Title\n\n**Bold** and *italic*\n\n> Quote\n\n- List item";
    const result = stripMarkdown(input);
    expect(result).toContain("Title");
    expect(result).toContain("Bold");
    expect(result).toContain("italic");
    expect(result).toContain("Quote");
    expect(result).toContain("List item");
    expect(result).not.toContain("#");
    expect(result).not.toContain("**");
    expect(result).not.toContain(">");
  });

  it("handles CJK text", () => {
    expect(stripMarkdown("# 你好世界")).toBe("你好世界");
    expect(stripMarkdown("**中文粗体**")).toBe("中文粗体");
  });
});

describe("countWordsFromPlain", () => {
  it("counts English words", () => {
    expect(countWordsFromPlain("hello world")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(countWordsFromPlain("")).toBe(0);
  });

  it("returns 0 for whitespace-only", () => {
    expect(countWordsFromPlain("   ")).toBe(0);
  });

  it("counts single word", () => {
    expect(countWordsFromPlain("hello")).toBe(1);
  });

  it("handles multiple spaces between words", () => {
    const result = countWordsFromPlain("hello    world");
    expect(result).toBe(2);
  });

  it("does not count CJK punctuation as words", () => {
    // A lone fullwidth comma is punctuation, not a word.
    expect(countWordsFromPlain("，")).toBe(0);
  });

  it("counts CJK glyphs but not the punctuation between them", () => {
    // 你 好 世 界 = 4 words; ，！ are stripped, not counted.
    expect(countWordsFromPlain("你好，世界！")).toBe(4);
  });

  it("does not count ASCII punctuation as words", () => {
    // "Hello, world!" — comma/bang stripped → 2 words, not inflated.
    expect(countWordsFromPlain("Hello, world!")).toBe(2);
  });

  it("returns 0 for a punctuation-only selection", () => {
    expect(countWordsFromPlain("，！。?!.,")).toBe(0);
  });
});

describe("countCharsFromPlain", () => {
  it("counts non-whitespace characters", () => {
    expect(countCharsFromPlain("hello world")).toBe(10);
  });

  it("returns 0 for empty string", () => {
    expect(countCharsFromPlain("")).toBe(0);
  });

  it("returns 0 for whitespace-only", () => {
    expect(countCharsFromPlain("   \n\t  ")).toBe(0);
  });

  it("counts CJK characters", () => {
    expect(countCharsFromPlain("你好世界")).toBe(4);
  });

  it("ignores tabs and newlines", () => {
    expect(countCharsFromPlain("a\tb\nc")).toBe(3);
  });

  it("handles mixed content", () => {
    expect(countCharsFromPlain("hello 你好")).toBe(7);
  });

  it("counts astral/emoji code points as one each (not UTF-16 length)", () => {
    // "😀a" — emoji is a single code point but 2 UTF-16 units; .length would
    // yield 3, Array.from yields 2.
    expect(countCharsFromPlain("😀a")).toBe(2);
  });
});

describe("computeTextMetrics", () => {
  it("returns all-zero metrics for empty string", () => {
    expect(computeTextMetrics("")).toEqual({
      words: 0,
      charsWithSpaces: 0,
      charsNoSpaces: 0,
      cjkChars: 0,
      charsNoPunctuation: 0,
    });
  });

  it("counts pure English prose", () => {
    const m = computeTextMetrics("hello world");
    expect(m.words).toBe(2);
    expect(m.charsWithSpaces).toBe(11); // includes the space
    expect(m.charsNoSpaces).toBe(10);
    expect(m.cjkChars).toBe(0);
    expect(m.charsNoPunctuation).toBe(10);
  });

  it("counts pure Chinese with CJK punctuation", () => {
    // "你好，世界！" — 4 Han chars, 2 fullwidth punctuation marks (，！)
    const m = computeTextMetrics("你好，世界！");
    expect(m.cjkChars).toBe(4);
    expect(m.charsWithSpaces).toBe(6); // 4 Han + 2 punctuation
    expect(m.charsNoSpaces).toBe(6); // no spaces present
    expect(m.charsNoPunctuation).toBe(4); // ，！ excluded
    // Punctuation is stripped before alfaaz, so only the 4 Han glyphs count:
    // 你 好 世 界 → 4 words (fullwidth ，！ are not counted).
    expect(m.words).toBe(4);
  });

  it("counts Japanese hiragana and katakana as CJK", () => {
    // ひらがな (4 hiragana) + カタカナ (4 katakana) + 日本 (2 Han)
    const m = computeTextMetrics("ひらがなカタカナ日本");
    expect(m.cjkChars).toBe(10);
  });

  it("counts mixed CJK + Latin", () => {
    // "Hi 你好" — 2 Latin word chars in "Hi", space, 2 Han
    const m = computeTextMetrics("Hi 你好");
    expect(m.charsWithSpaces).toBe(5); // H i <space> 你 好
    expect(m.charsNoSpaces).toBe(4);
    expect(m.cjkChars).toBe(2);
    expect(m.charsNoPunctuation).toBe(4); // no punctuation
    expect(m.words).toBe(3); // "Hi" + 你 + 好
  });

  it("excludes ASCII and CJK punctuation and symbols from charsNoPunctuation", () => {
    // "a, b! (c) — $5 + 3%"
    const m = computeTextMetrics("a, b! (c) — $5 + 3%");
    // Non-whitespace chars: a , b ! ( c ) — $ 5 + 3 %  = 13
    expect(m.charsNoSpaces).toBe(13);
    // Strip punctuation (\p{P}: , ! ( ) —) and symbols (\p{S}: $ + %):
    // remaining alphanumerics: a b c 5 3 = 5
    expect(m.charsNoPunctuation).toBe(5);
  });

  it("counts astral/emoji code points correctly (not UTF-16 length)", () => {
    // "👍🏽a" — a thumbs-up + skin-tone modifier (2 code points) + "a"
    const m = computeTextMetrics("👍🏽a");
    // Array.from yields 3 code points; .length would yield 5 (UTF-16 units).
    expect(m.charsWithSpaces).toBe(3);
    expect(m.charsNoSpaces).toBe(3);
    expect(m.cjkChars).toBe(0);
    // Emoji are \p{S} (symbols) → excluded from charsNoPunctuation, leaving "a".
    expect(m.charsNoPunctuation).toBe(1);
  });

  it("treats every CJK char as one word (alfaaz semantics)", () => {
    const m = computeTextMetrics("中文字数统计");
    expect(m.cjkChars).toBe(6);
    expect(m.words).toBe(6);
  });

  it("counts a mixed CJK + Latin sample without counting punctuation as words", () => {
    // "你好世界测试 hello world, ok!" — live-verified breakdown.
    const m = computeTextMetrics("你好世界测试 hello world, ok!");
    expect(m.cjkChars).toBe(6);
    expect(m.charsNoSpaces).toBe(20);
    expect(m.charsNoPunctuation).toBe(18); // , and ! excluded
    // 6 CJK glyphs + hello + world + ok = 9 words; , and ! are not counted.
    expect(m.words).toBe(9);
  });

  it("handles whitespace-only input", () => {
    const m = computeTextMetrics("   \n\t  ");
    expect(m.words).toBe(0);
    expect(m.charsWithSpaces).toBe(7);
    expect(m.charsNoSpaces).toBe(0);
    expect(m.cjkChars).toBe(0);
    expect(m.charsNoPunctuation).toBe(0);
  });
});
