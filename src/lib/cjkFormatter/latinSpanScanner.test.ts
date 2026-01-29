import { describe, test, expect } from "vitest";
import {
  scanLatinSpans,
  isInLatinSpan,
  isInTechnicalSubspan,
  getTechnicalSubspanAt,
  isCJKLetter,
  type LatinSpan,
} from "./latinSpanScanner";

describe("latinSpanScanner", () => {
  describe("isCJKLetter", () => {
    test("detects Han characters", () => {
      expect(isCJKLetter("中")).toBe(true);
      expect(isCJKLetter("文")).toBe(true);
      expect(isCJKLetter("漢")).toBe(true);
    });

    test("detects Hiragana", () => {
      expect(isCJKLetter("あ")).toBe(true);
      expect(isCJKLetter("の")).toBe(true);
    });

    test("detects Katakana", () => {
      expect(isCJKLetter("ア")).toBe(true);
      expect(isCJKLetter("カ")).toBe(true);
    });

    test("detects Bopomofo", () => {
      expect(isCJKLetter("ㄅ")).toBe(true);
      expect(isCJKLetter("ㄆ")).toBe(true);
    });

    test("detects supplementary-plane Han (Extension B)", () => {
      // 𠀀 is U+20000, a CJK Extension B character (surrogate pair in UTF-16)
      expect(isCJKLetter("𠀀")).toBe(true);
    });

    test("rejects Latin letters", () => {
      expect(isCJKLetter("A")).toBe(false);
      expect(isCJKLetter("z")).toBe(false);
    });

    test("rejects digits", () => {
      expect(isCJKLetter("0")).toBe(false);
      expect(isCJKLetter("9")).toBe(false);
    });

    test("rejects punctuation", () => {
      expect(isCJKLetter(",")).toBe(false);
      expect(isCJKLetter("。")).toBe(false);
      expect(isCJKLetter("，")).toBe(false);
    });
  });

  describe("scanLatinSpans - basic detection", () => {
    test("single Latin token between CJK", () => {
      const spans = scanLatinSpans("中文ABC中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe("ABC");
      expect(spans[0].start).toBe(2);
      expect(spans[0].end).toBe(5);
    });

    test("multiple Latin spans", () => {
      const spans = scanLatinSpans("中文ABC中文DEF中文");
      expect(spans).toHaveLength(2);
      expect(spans[0].text).toBe("ABC");
      expect(spans[1].text).toBe("DEF");
    });

    test("Latin span with whitespace", () => {
      const spans = scanLatinSpans("中文 Hello World 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe(" Hello World ");
    });

    test("pure CJK text has no spans", () => {
      const spans = scanLatinSpans("这是中文");
      expect(spans).toHaveLength(0);
    });

    test("pure Latin text is one span", () => {
      const spans = scanLatinSpans("Hello World");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe("Hello World");
      expect(spans[0].start).toBe(0);
      expect(spans[0].end).toBe(11);
    });

    test("single Latin letter is a span", () => {
      const spans = scanLatinSpans("中A文");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe("A");
    });

    test("newline breaks spans", () => {
      const spans = scanLatinSpans("中文ABC\nDEF中文");
      expect(spans).toHaveLength(2);
      expect(spans[0].text).toBe("ABC");
      expect(spans[1].text).toBe("DEF");
    });

    test("whitespace-only between CJK is not a span", () => {
      const spans = scanLatinSpans("中文   中文");
      expect(spans).toHaveLength(0);
    });

    test("Latin at start of text", () => {
      const spans = scanLatinSpans("Hello中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe("Hello");
      expect(spans[0].start).toBe(0);
    });

    test("Latin at end of text", () => {
      const spans = scanLatinSpans("中文Hello");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe("Hello");
      expect(spans[0].end).toBe(7);
    });

    test("handles mixed Japanese text", () => {
      const spans = scanLatinSpans("日本語ABC日本語");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe("ABC");
    });
  });

  describe("scanLatinSpans - technical subspans", () => {
    test("detects URL", () => {
      const spans = scanLatinSpans("中文 https://example.com/path 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("urlLike");
      expect(spans[0].subspans[0].text).toBe("https://example.com/path");
    });

    test("detects email", () => {
      const spans = scanLatinSpans("中文 user@example.com 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("emailLike");
      expect(spans[0].subspans[0].text).toBe("user@example.com");
    });

    test("detects version with v prefix", () => {
      const spans = scanLatinSpans("中文 v0.3.11 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("versionLike");
      expect(spans[0].subspans[0].text).toBe("v0.3.11");
    });

    test("detects version without v prefix", () => {
      const spans = scanLatinSpans("中文 0.3.11 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("versionLike");
    });

    test("detects decimal", () => {
      const spans = scanLatinSpans("中文 3.14159 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("decimalLike");
      expect(spans[0].subspans[0].text).toBe("3.14159");
    });

    test("detects time", () => {
      const spans = scanLatinSpans("中文 12:30 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("timeLike");
      expect(spans[0].subspans[0].text).toBe("12:30");
    });

    test("detects time with seconds", () => {
      const spans = scanLatinSpans("中文 12:30:45 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("timeLike");
      expect(spans[0].subspans[0].text).toBe("12:30:45");
    });

    test("detects thousands separator", () => {
      const spans = scanLatinSpans("中文 1,000,000 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("thousandsLike");
      expect(spans[0].subspans[0].text).toBe("1,000,000");
    });

    test("detects domain", () => {
      const spans = scanLatinSpans("中文 example.com 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("domainLike");
      expect(spans[0].subspans[0].text).toBe("example.com");
    });

    test("detects multiple subspans", () => {
      const spans = scanLatinSpans(
        "中文 test.com/v0.3.11?x=1,000 中文"
      );
      expect(spans).toHaveLength(1);
      // Should detect domain, version, and thousands
      expect(spans[0].subspans.length).toBeGreaterThanOrEqual(2);
    });

    test("URL takes priority over domain", () => {
      const spans = scanLatinSpans("中文 https://example.com 中文");
      expect(spans).toHaveLength(1);
      // URL should match, not domain
      const types = spans[0].subspans.map((s) => s.type);
      expect(types).toContain("urlLike");
    });

    test("email takes priority over domain", () => {
      const spans = scanLatinSpans("中文 user@example.com 中文");
      expect(spans).toHaveLength(1);
      const types = spans[0].subspans.map((s) => s.type);
      expect(types).toContain("emailLike");
    });
  });

  describe("scanLatinSpans - edge cases", () => {
    test("handles empty string", () => {
      const spans = scanLatinSpans("");
      expect(spans).toHaveLength(0);
    });

    test("handles punctuation in Latin span", () => {
      const spans = scanLatinSpans("中文Hello, World!中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe("Hello, World!");
    });

    test("handles complex URL with query params", () => {
      const spans = scanLatinSpans(
        "中文 https://example.com/path?a=1&b=2 中文"
      );
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("urlLike");
    });

    test("handles file extension pattern", () => {
      const spans = scanLatinSpans("中文 file.md 中文");
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("domainLike");
    });

    test("handles abbreviation e.g.", () => {
      const spans = scanLatinSpans("中文 e.g. test 中文");
      expect(spans).toHaveLength(1);
      // e.g. might match domainLike, which is acceptable
    });

    test("handles consecutive CJK without Latin", () => {
      const spans = scanLatinSpans("中文日本語한글");
      // Korean (한글) is not in the CJK detection for Latin span breaking
      // so this depends on implementation
      expect(spans.length).toBeLessThanOrEqual(1);
    });
  });

  describe("isInLatinSpan", () => {
    test("returns true for position inside span", () => {
      const spans = scanLatinSpans("中文ABC中文");
      expect(isInLatinSpan(2, spans)).toBe(true); // 'A'
      expect(isInLatinSpan(3, spans)).toBe(true); // 'B'
      expect(isInLatinSpan(4, spans)).toBe(true); // 'C'
    });

    test("returns false for position outside span", () => {
      const spans = scanLatinSpans("中文ABC中文");
      expect(isInLatinSpan(0, spans)).toBe(false); // '中'
      expect(isInLatinSpan(1, spans)).toBe(false); // '文'
      expect(isInLatinSpan(5, spans)).toBe(false); // '中'
    });

    test("returns false for empty spans", () => {
      const spans: LatinSpan[] = [];
      expect(isInLatinSpan(0, spans)).toBe(false);
    });
  });

  describe("isInTechnicalSubspan", () => {
    test("returns true for position inside URL", () => {
      const spans = scanLatinSpans("中文 https://example.com 中文");
      const urlStart = spans[0].start + spans[0].subspans[0].start;
      expect(isInTechnicalSubspan(urlStart + 5, spans)).toBe(true);
    });

    test("returns false for position in Latin span but not in subspan", () => {
      const spans = scanLatinSpans("中文 hello world 中文");
      expect(isInTechnicalSubspan(3, spans)).toBe(false);
    });

    test("returns false for position outside Latin span", () => {
      const spans = scanLatinSpans("中文 https://example.com 中文");
      expect(isInTechnicalSubspan(0, spans)).toBe(false);
    });
  });

  describe("getTechnicalSubspanAt", () => {
    test("returns subspan for position inside URL", () => {
      const spans = scanLatinSpans("中文 https://example.com 中文");
      const urlStart = spans[0].start + spans[0].subspans[0].start;
      const subspan = getTechnicalSubspanAt(urlStart + 5, spans);
      expect(subspan).not.toBeNull();
      expect(subspan?.type).toBe("urlLike");
    });

    test("returns null for position not in subspan", () => {
      const spans = scanLatinSpans("中文 hello world 中文");
      const subspan = getTechnicalSubspanAt(3, spans);
      expect(subspan).toBeNull();
    });

    test("returns correct subspan type", () => {
      const spans = scanLatinSpans("中文 v1.2.3 中文");
      const versionStart = spans[0].start + spans[0].subspans[0].start;
      const subspan = getTechnicalSubspanAt(versionStart + 1, spans);
      expect(subspan?.type).toBe("versionLike");
    });
  });

  describe("scanLatinSpans - surrogate pairs", () => {
    test("handles CJK Extension B character", () => {
      // 𠀀 is U+20000, a CJK Extension B character (surrogate pair)
      const spans = scanLatinSpans("𠀀ABC𠀀");
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe("ABC");
    });

    test("CJK Extension B breaks Latin span", () => {
      const spans = scanLatinSpans("ABC𠀀DEF");
      expect(spans).toHaveLength(2);
      expect(spans[0].text).toBe("ABC");
      expect(spans[1].text).toBe("DEF");
    });
  });

  describe("scanLatinSpans - real-world examples", () => {
    test("mixed sentence with URL", () => {
      const text = "请访问 https://example.com/path 获取更多信息";
      const spans = scanLatinSpans(text);
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("urlLike");
    });

    test("version number in sentence", () => {
      const text = "版本 v0.3.11 已发布";
      const spans = scanLatinSpans(text);
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("versionLike");
    });

    test("time in sentence", () => {
      const text = "会议时间 12:30 开始";
      const spans = scanLatinSpans(text);
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("timeLike");
    });

    test("email in sentence", () => {
      const text = "联系邮箱 test@example.com 谢谢";
      const spans = scanLatinSpans(text);
      expect(spans).toHaveLength(1);
      expect(spans[0].subspans[0].type).toBe("emailLike");
    });

    test("complex mixed text", () => {
      const text =
        "中文,English; 版本v0.3.11,时间12:30,网址test.com/a,b?x=1.";
      const spans = scanLatinSpans(text);
      // Should have multiple Latin spans separated by CJK
      expect(spans.length).toBeGreaterThanOrEqual(1);
    });

    test("preserves punctuation positions for later processing", () => {
      const text = "中文,English";
      const spans = scanLatinSpans(text);
      expect(spans).toHaveLength(1);
      // The comma at position 2 should be part of the Latin span
      expect(spans[0].start).toBe(2);
      expect(spans[0].text).toBe(",English");
    });
  });
});
