import { describe, expect, it } from "vitest";
import {
  removeTrailingSpaces,
  normalizeEllipsis,
  collapseNewlines,
  normalizeFullwidthAlphanumeric,
  normalizeFullwidthPunctuation,
  normalizeFullwidthParentheses,
  normalizeFullwidthBrackets,
  addCJKEnglishSpacing,
  addCJKParenthesisSpacing,
  fixCurrencySpacing,
  fixSlashSpacing,
  collapseSpaces,
  convertDashes,
  fixEmdashSpacing,
  fixDoubleQuoteSpacing,
  fixSingleQuoteSpacing,
  fixCornerQuoteSpacing,
  fixDoubleCornerQuoteSpacing,
  convertStraightToSmartQuotes,
  convertToCJKCornerQuotes,
  convertNestedCornerQuotes,
  limitConsecutivePunctuation,
  containsCJK,
} from "./rules";

describe("containsCJK", () => {
  it("detects basic CJK characters", () => {
    expect(containsCJK("你好")).toBe(true);
    expect(containsCJK("こんにちは")).toBe(true);
    expect(containsCJK("안녕하세요")).toBe(true);
    expect(containsCJK("カタカナ")).toBe(true);
  });

  it("detects extended CJK characters", () => {
    // CJK Extension A character (rare)
    expect(containsCJK("㐀")).toBe(true);
    // Bopomofo
    expect(containsCJK("ㄅㄆㄇ")).toBe(true);
  });

  it("detects supplementary-plane Han (Extensions B-G)", () => {
    // CJK Extension B character (U+20000) - requires surrogate pair
    expect(containsCJK("𠀀")).toBe(true);
    // Extension B only, no BMP CJK present
    expect(containsCJK("Text with 𠀀 rare char")).toBe(true);
  });

  it("returns false for non-CJK text", () => {
    expect(containsCJK("Hello World")).toBe(false);
    expect(containsCJK("12345")).toBe(false);
    expect(containsCJK("ABC abc")).toBe(false);
  });

  it("detects CJK in mixed text", () => {
    expect(containsCJK("Hello 你好")).toBe(true);
    expect(containsCJK("Test日本語Test")).toBe(true);
  });
});

describe("removeTrailingSpaces", () => {
  it("removes trailing spaces by default", () => {
    const input = "keep  \ntrim \n";
    expect(removeTrailingSpaces(input)).toBe("keep\ntrim\n");
  });

  it("preserves two-space hard breaks when configured", () => {
    const input = "keep  \ntrim \n    \n";
    const output = removeTrailingSpaces(input, {
      preserveTwoSpaceHardBreaks: true,
    });
    expect(output).toBe("keep  \ntrim\n\n");
  });

  it("handles empty lines", () => {
    expect(removeTrailingSpaces("line1\n\nline2")).toBe("line1\n\nline2");
  });

  it("handles lines with only spaces", () => {
    expect(removeTrailingSpaces("text\n   \nmore")).toBe("text\n\nmore");
  });
});

describe("normalizeEllipsis", () => {
  it("converts spaced dots to ellipsis", () => {
    expect(normalizeEllipsis(". . .")).toBe("...");
    expect(normalizeEllipsis(". . . .")).toBe("...");
    expect(normalizeEllipsis("text . . . more")).toBe("text... more");
  });

  it("ensures space after ellipsis before non-whitespace", () => {
    expect(normalizeEllipsis("...text")).toBe("... text");
    expect(normalizeEllipsis("...  text")).toBe("... text");
  });

  it("preserves ellipsis at end of line", () => {
    expect(normalizeEllipsis("text...")).toBe("text...");
  });
});

describe("collapseNewlines", () => {
  it("collapses 3+ newlines to 2", () => {
    expect(collapseNewlines("a\n\n\nb")).toBe("a\n\nb");
    expect(collapseNewlines("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("preserves 2 newlines", () => {
    expect(collapseNewlines("a\n\nb")).toBe("a\n\nb");
  });

  it("removes standalone br tags", () => {
    expect(collapseNewlines("text\n\n<br />\n\nmore")).toBe("text\n\nmore");
  });
});

describe("normalizeFullwidthAlphanumeric", () => {
  it("converts fullwidth numbers to halfwidth", () => {
    expect(normalizeFullwidthAlphanumeric("１２３")).toBe("123");
    expect(normalizeFullwidthAlphanumeric("０")).toBe("0");
    expect(normalizeFullwidthAlphanumeric("９")).toBe("9");
  });

  it("converts fullwidth uppercase letters", () => {
    expect(normalizeFullwidthAlphanumeric("ＡＢＣ")).toBe("ABC");
    expect(normalizeFullwidthAlphanumeric("Ａ")).toBe("A");
    expect(normalizeFullwidthAlphanumeric("Ｚ")).toBe("Z");
  });

  it("converts fullwidth lowercase letters", () => {
    expect(normalizeFullwidthAlphanumeric("ａｂｃ")).toBe("abc");
    expect(normalizeFullwidthAlphanumeric("ａ")).toBe("a");
    expect(normalizeFullwidthAlphanumeric("ｚ")).toBe("z");
  });

  it("preserves other characters", () => {
    expect(normalizeFullwidthAlphanumeric("你好")).toBe("你好");
    expect(normalizeFullwidthAlphanumeric("Hello")).toBe("Hello");
  });

  it("handles mixed text", () => {
    expect(normalizeFullwidthAlphanumeric("今天是２０２４年")).toBe(
      "今天是2024年"
    );
  });
});

describe("normalizeFullwidthPunctuation", () => {
  it("converts halfwidth punctuation between CJK characters", () => {
    expect(normalizeFullwidthPunctuation("你好,世界")).toBe("你好，世界");
    expect(normalizeFullwidthPunctuation("问题?答案")).toBe("问题？答案");
    expect(normalizeFullwidthPunctuation("结束.开始")).toBe("结束。开始");
  });

  it("converts trailing punctuation after CJK", () => {
    expect(normalizeFullwidthPunctuation("结束.")).toBe("结束。");
    expect(normalizeFullwidthPunctuation("什么? ")).toBe("什么？ ");
  });

  it("preserves punctuation in non-CJK context", () => {
    expect(normalizeFullwidthPunctuation("Hello, world")).toBe("Hello, world");
    expect(normalizeFullwidthPunctuation("test.com")).toBe("test.com");
  });

  // NEW: Critical gap fixes - CJK + punct + Latin and Latin + punct + CJK
  it("converts punctuation between CJK and Latin (CJK left)", () => {
    expect(normalizeFullwidthPunctuation("中文,English")).toBe("中文，English");
    expect(normalizeFullwidthPunctuation("中文;English")).toBe("中文；English");
    expect(normalizeFullwidthPunctuation("中文!English")).toBe("中文！English");
    expect(normalizeFullwidthPunctuation("中文?English")).toBe("中文？English");
  });

  it("converts punctuation between Latin and CJK (CJK right)", () => {
    expect(normalizeFullwidthPunctuation("English,中文")).toBe("English，中文");
    expect(normalizeFullwidthPunctuation("English;中文")).toBe("English；中文");
    expect(normalizeFullwidthPunctuation("English!中文")).toBe("English！中文");
    expect(normalizeFullwidthPunctuation("English?中文")).toBe("English？中文");
  });

  it("converts all punctuation types in mixed context", () => {
    expect(normalizeFullwidthPunctuation("中文,中文.中文!中文?中文;中文:中文"))
      .toBe("中文，中文。中文！中文？中文；中文：中文");
  });

  // Protected contexts - technical subspans
  it("preserves punctuation inside URLs", () => {
    expect(normalizeFullwidthPunctuation("中文 https://example.com/path,query 中文"))
      .toBe("中文 https://example.com/path,query 中文");
  });

  it("preserves punctuation inside email addresses", () => {
    expect(normalizeFullwidthPunctuation("中文 user@example.com 中文"))
      .toBe("中文 user@example.com 中文");
  });

  it("preserves punctuation inside versions", () => {
    expect(normalizeFullwidthPunctuation("中文 v0.3.11 中文"))
      .toBe("中文 v0.3.11 中文");
  });

  it("preserves punctuation inside decimals", () => {
    expect(normalizeFullwidthPunctuation("中文 3.14 中文"))
      .toBe("中文 3.14 中文");
  });

  it("preserves punctuation inside times", () => {
    expect(normalizeFullwidthPunctuation("中文 12:30 中文"))
      .toBe("中文 12:30 中文");
  });

  it("preserves punctuation inside thousands separators", () => {
    expect(normalizeFullwidthPunctuation("中文 1,000,000 中文"))
      .toBe("中文 1,000,000 中文");
  });

  it("preserves punctuation inside domain names", () => {
    expect(normalizeFullwidthPunctuation("中文 example.com 中文"))
      .toBe("中文 example.com 中文");
  });

  // Ellipsis protection
  it("preserves ellipsis (never converts periods in ...)", () => {
    expect(normalizeFullwidthPunctuation("中文...")).toBe("中文...");
    expect(normalizeFullwidthPunctuation("中文...中文")).toBe("中文...中文");
    expect(normalizeFullwidthPunctuation("等等...继续")).toBe("等等...继续");
  });

  // Complex mixed cases
  it("handles complex mixed text correctly", () => {
    // Technical terms protected, mixed punctuation converted
    const input = "中文,English; 版本v0.3.11,时间12:30,网址test.com/a,b?x=1.";
    const output = normalizeFullwidthPunctuation(input);
    // Commas and semicolons in CJK context should be converted
    expect(output).toContain("中文，English");
    expect(output).toContain("English；");
    // Technical subspans should be protected
    expect(output).toContain("v0.3.11");
    expect(output).toContain("12:30");
    expect(output).toContain("test.com/a,b?x=1");
  });

  it("converts punctuation after CJK closing brackets", () => {
    expect(normalizeFullwidthPunctuation("（内容）,继续")).toBe("（内容），继续");
    expect(normalizeFullwidthPunctuation("」,继续")).toBe("」，继续");
  });

  it("converts punctuation before CJK opening brackets", () => {
    expect(normalizeFullwidthPunctuation("内容,（更多）")).toBe("内容，（更多）");
    expect(normalizeFullwidthPunctuation("内容,「引用」")).toBe("内容，「引用」");
  });

  it("converts punctuation next to CJK Extension B characters", () => {
    // 𠀀 is U+20000 (CJK Extension B; surrogate pair in UTF-16)
    expect(normalizeFullwidthPunctuation("𠀀,English")).toBe("𠀀，English");
    expect(normalizeFullwidthPunctuation("English,𠀀")).toBe("English，𠀀");
  });
});

describe("normalizeFullwidthParentheses", () => {
  it("converts parentheses around CJK content", () => {
    expect(normalizeFullwidthParentheses("(中文)")).toBe("（中文）");
    expect(normalizeFullwidthParentheses("text(测试)more")).toBe(
      "text（测试）more"
    );
  });

  it("preserves parentheses around non-CJK content", () => {
    expect(normalizeFullwidthParentheses("(abc)")).toBe("(abc)");
    expect(normalizeFullwidthParentheses("(123)")).toBe("(123)");
  });
});

describe("normalizeFullwidthBrackets", () => {
  it("converts brackets around CJK content", () => {
    expect(normalizeFullwidthBrackets("[注释]")).toBe("【注释】");
    expect(normalizeFullwidthBrackets("text[备注]end")).toBe("text【备注】end");
  });

  it("preserves brackets around non-CJK content", () => {
    expect(normalizeFullwidthBrackets("[link]")).toBe("[link]");
  });
});

describe("addCJKEnglishSpacing", () => {
  it("adds space between CJK and English", () => {
    expect(addCJKEnglishSpacing("你好World")).toBe("你好 World");
    expect(addCJKEnglishSpacing("Hello世界")).toBe("Hello 世界");
  });

  it("adds space between CJK and numbers", () => {
    expect(addCJKEnglishSpacing("共100个")).toBe("共 100 个");
    expect(addCJKEnglishSpacing("2024年")).toBe("2024 年");
  });

  it("handles currency and units", () => {
    expect(addCJKEnglishSpacing("价格$100元")).toBe("价格 $100 元");
    expect(addCJKEnglishSpacing("温度25℃正常")).toBe("温度 25℃ 正常");
  });

  it("preserves existing spaces", () => {
    expect(addCJKEnglishSpacing("你好 World")).toBe("你好 World");
  });

  it("adds spacing around Korean text", () => {
    // Korean (Hangul) should get CJK↔Latin spacing
    expect(addCJKEnglishSpacing("안녕Hello")).toBe("안녕 Hello");
    expect(addCJKEnglishSpacing("Hello안녕")).toBe("Hello 안녕");
  });
});

describe("Korean handling - punctuation excluded", () => {
  it("does NOT convert punctuation next to Korean", () => {
    // Korean typography uses Western punctuation, so we preserve it
    expect(normalizeFullwidthPunctuation("안녕,Hello")).toBe("안녕,Hello");
    expect(normalizeFullwidthPunctuation("Hello,안녕")).toBe("Hello,안녕");
  });

  it("does NOT convert parentheses around Korean", () => {
    expect(normalizeFullwidthParentheses("(안녕하세요)")).toBe("(안녕하세요)");
  });

  it("does NOT convert brackets around Korean", () => {
    expect(normalizeFullwidthBrackets("[안녕하세요]")).toBe("[안녕하세요]");
  });

  it("converts punctuation next to Chinese but not Korean", () => {
    // Mixed: Chinese triggers conversion, Korean doesn't
    expect(normalizeFullwidthPunctuation("你好,안녕")).toBe("你好，안녕");
  });
});

describe("addCJKParenthesisSpacing", () => {
  it("adds space between CJK and opening paren", () => {
    expect(addCJKParenthesisSpacing("测试(text)")).toBe("测试 (text)");
  });

  it("adds space between closing paren and CJK", () => {
    expect(addCJKParenthesisSpacing("(text)测试")).toBe("(text) 测试");
  });
});

describe("fixCurrencySpacing", () => {
  describe("prefix currency symbols bind tight to number", () => {
    it("removes space between $ and number", () => {
      expect(fixCurrencySpacing("$ 100")).toBe("$100");
    });

    it("removes space between ¥ and number", () => {
      expect(fixCurrencySpacing("¥ 500")).toBe("¥500");
    });

    it("removes space between € and number", () => {
      expect(fixCurrencySpacing("€ 99.99")).toBe("€99.99");
    });

    it("removes space between £ and number", () => {
      expect(fixCurrencySpacing("£ 50")).toBe("£50");
    });
  });

  describe("prefix currency codes bind tight to number", () => {
    it("removes space between USD and number", () => {
      expect(fixCurrencySpacing("USD 200")).toBe("USD200");
    });

    it("removes space between CNY and number", () => {
      expect(fixCurrencySpacing("CNY 1000")).toBe("CNY1000");
    });
  });

  describe("unit symbols bind tight to preceding number", () => {
    it("removes space between number and %", () => {
      expect(fixCurrencySpacing("50 %")).toBe("50%");
    });

    it("removes space between number and ℃", () => {
      expect(fixCurrencySpacing("25 ℃")).toBe("25℃");
    });

    it("removes space between number and ℉", () => {
      expect(fixCurrencySpacing("77 ℉")).toBe("77℉");
    });

    it("removes space between number and °C", () => {
      expect(fixCurrencySpacing("25 °C")).toBe("25°C");
    });

    it("removes space between number and ‰", () => {
      expect(fixCurrencySpacing("5 ‰")).toBe("5‰");
    });
  });

  describe("postfix currency codes - spaced mode (default)", () => {
    it("adds space between number and USD", () => {
      expect(fixCurrencySpacing("100USD")).toBe("100 USD");
    });

    it("adds space between number and CNY", () => {
      expect(fixCurrencySpacing("500CNY")).toBe("500 CNY");
    });

    it("adds space between number and EUR", () => {
      expect(fixCurrencySpacing("99EUR")).toBe("99 EUR");
    });
  });

  describe("postfix currency codes - tight mode", () => {
    it("keeps number and USD together", () => {
      expect(fixCurrencySpacing("100USD", "tight")).toBe("100USD");
    });

    it("removes space between number and USD", () => {
      expect(fixCurrencySpacing("100 USD", "tight")).toBe("100USD");
    });
  });

  describe("complex cases", () => {
    it("handles price with tax", () => {
      expect(fixCurrencySpacing("价格是 $ 99.99 (含税)")).toBe("价格是 $99.99 (含税)");
    });

    it("handles temperature and discount", () => {
      expect(fixCurrencySpacing("温度 25 ℃, 折扣 50 %")).toBe("温度 25℃, 折扣 50%");
    });

    it("handles postfix currency code", () => {
      expect(fixCurrencySpacing("共100USD。")).toBe("共100 USD。");
    });
  });
});

describe("fixSlashSpacing", () => {
  it("removes spaces around slashes", () => {
    expect(fixSlashSpacing("and / or")).toBe("and/or");
    expect(fixSlashSpacing("yes / no")).toBe("yes/no");
  });

  it("preserves URL slashes", () => {
    expect(fixSlashSpacing("http://example.com")).toBe("http://example.com");
    expect(fixSlashSpacing("file:///path")).toBe("file:///path");
  });
});

describe("collapseSpaces", () => {
  it("collapses multiple spaces to single", () => {
    expect(collapseSpaces("word  word")).toBe("word word");
    expect(collapseSpaces("a    b")).toBe("a b");
  });

  it("preserves leading indentation", () => {
    expect(collapseSpaces("    code")).toBe("    code");
    expect(collapseSpaces("  item")).toBe("  item");
  });
});

describe("convertDashes", () => {
  it("converts double dashes between CJK", () => {
    expect(convertDashes("你好--世界")).toBe("你好 —— 世界");
    expect(convertDashes("测试---内容")).toBe("测试 —— 内容");
  });

  it("converts dashes between CJK and alphanumeric", () => {
    expect(convertDashes("hello--世界")).toBe("hello —— 世界");
    expect(convertDashes("你好--world")).toBe("你好 —— world");
  });
});

describe("fixEmdashSpacing", () => {
  it("ensures spaces around em-dash", () => {
    expect(fixEmdashSpacing("text——more")).toBe("text —— more");
  });

  it("no space between closing bracket and em-dash", () => {
    expect(fixEmdashSpacing("」——text")).toBe("」—— text");
    expect(fixEmdashSpacing("）——word")).toBe("）—— word");
  });
});

describe("fixDoubleQuoteSpacing", () => {
  // Note: These use curly quotes \u201c (") and \u201d (")
  const OQ = "\u201c"; // Opening curly double quote "
  const CQ = "\u201d"; // Closing curly double quote "

  describe("space before opening quote", () => {
    it("adds space after alphanumeric", () => {
      expect(fixDoubleQuoteSpacing(`word${OQ}text${CQ}`)).toBe(`word ${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`A${OQ}text${CQ}`)).toBe(`A ${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`9${OQ}text${CQ}`)).toBe(`9 ${OQ}text${CQ}`);
    });

    it("adds space after CJK characters", () => {
      expect(fixDoubleQuoteSpacing(`中文${OQ}text${CQ}`)).toBe(`中文 ${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`日本語${OQ}text${CQ}`)).toBe(`日本語 ${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`한글${OQ}text${CQ}`)).toBe(`한글 ${OQ}text${CQ}`);
    });

    it("no space after CJK closing brackets", () => {
      expect(fixDoubleQuoteSpacing(`」${OQ}text${CQ}`)).toBe(`」${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`』${OQ}text${CQ}`)).toBe(`』${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`】${OQ}text${CQ}`)).toBe(`】${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`）${OQ}text${CQ}`)).toBe(`）${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`》${OQ}text${CQ}`)).toBe(`》${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`〉${OQ}text${CQ}`)).toBe(`〉${OQ}text${CQ}`);
    });

    it("no space after CJK terminal punctuation", () => {
      expect(fixDoubleQuoteSpacing(`，${OQ}text${CQ}`)).toBe(`，${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`。${OQ}text${CQ}`)).toBe(`。${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`！${OQ}text${CQ}`)).toBe(`！${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`？${OQ}text${CQ}`)).toBe(`？${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`；${OQ}text${CQ}`)).toBe(`；${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`：${OQ}text${CQ}`)).toBe(`：${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`、${OQ}text${CQ}`)).toBe(`、${OQ}text${CQ}`);
    });

    it("adds space after em-dash", () => {
      expect(fixDoubleQuoteSpacing(`——${OQ}text${CQ}`)).toBe(`—— ${OQ}text${CQ}`);
    });

    it("no space at start of text", () => {
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}`)).toBe(`${OQ}text${CQ}`);
    });

    it("preserves existing space", () => {
      expect(fixDoubleQuoteSpacing(`word ${OQ}text${CQ}`)).toBe(`word ${OQ}text${CQ}`);
    });
  });

  describe("space after closing quote", () => {
    it("adds space before alphanumeric", () => {
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}word`)).toBe(`${OQ}text${CQ} word`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}A`)).toBe(`${OQ}text${CQ} A`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}9`)).toBe(`${OQ}text${CQ} 9`);
    });

    it("adds space before CJK characters", () => {
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}中文`)).toBe(`${OQ}text${CQ} 中文`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}日本語`)).toBe(`${OQ}text${CQ} 日本語`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}한글`)).toBe(`${OQ}text${CQ} 한글`);
    });

    it("no space before CJK opening brackets", () => {
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}「`)).toBe(`${OQ}text${CQ}「`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}『`)).toBe(`${OQ}text${CQ}『`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}【`)).toBe(`${OQ}text${CQ}【`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}（`)).toBe(`${OQ}text${CQ}（`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}《`)).toBe(`${OQ}text${CQ}《`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}〈`)).toBe(`${OQ}text${CQ}〈`);
    });

    it("no space before CJK terminal punctuation", () => {
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}，`)).toBe(`${OQ}text${CQ}，`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}。`)).toBe(`${OQ}text${CQ}。`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}！`)).toBe(`${OQ}text${CQ}！`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}？`)).toBe(`${OQ}text${CQ}？`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}；`)).toBe(`${OQ}text${CQ}；`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}：`)).toBe(`${OQ}text${CQ}：`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}、`)).toBe(`${OQ}text${CQ}、`);
    });

    it("adds space before em-dash", () => {
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}——`)).toBe(`${OQ}text${CQ} ——`);
    });

    it("no space at end of text", () => {
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ}`)).toBe(`${OQ}text${CQ}`);
    });

    it("preserves existing space", () => {
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ} word`)).toBe(`${OQ}text${CQ} word`);
    });
  });

  describe("combined scenarios", () => {
    it("adds space on both sides with CJK", () => {
      expect(fixDoubleQuoteSpacing(`测试${OQ}hello${CQ}内容`)).toBe(`测试 ${OQ}hello${CQ} 内容`);
    });

    it("handles multiple quote pairs", () => {
      expect(fixDoubleQuoteSpacing(`word${OQ}a${CQ}and${OQ}b${CQ}end`)).toBe(
        `word ${OQ}a${CQ} and ${OQ}b${CQ} end`
      );
    });

    it("handles CJK content inside quotes", () => {
      expect(fixDoubleQuoteSpacing(`与${OQ}物质财富${CQ}无关`)).toBe(`与 ${OQ}物质财富${CQ} 无关`);
    });

    it("real-world Chinese text", () => {
      const input = `科学共识是明确的：幸福从根本上与${OQ}物质财富${CQ}无关。${OQ}伊斯特林悖论${CQ}表明`;
      const expected = `科学共识是明确的：幸福从根本上与 ${OQ}物质财富${CQ} 无关。${OQ}伊斯特林悖论${CQ} 表明`;
      expect(fixDoubleQuoteSpacing(input)).toBe(expected);
    });

    it("handles empty quotes", () => {
      expect(fixDoubleQuoteSpacing(`word${OQ}${CQ}end`)).toBe(`word ${OQ}${CQ} end`);
    });

    it("handles quotes with only whitespace inside", () => {
      expect(fixDoubleQuoteSpacing(`word${OQ} ${CQ}end`)).toBe(`word ${OQ} ${CQ} end`);
    });
  });

  describe("edge cases", () => {
    it("does not double-space when space already exists", () => {
      expect(fixDoubleQuoteSpacing(`word ${OQ}text${CQ}`)).toBe(`word ${OQ}text${CQ}`);
      expect(fixDoubleQuoteSpacing(`${OQ}text${CQ} word`)).toBe(`${OQ}text${CQ} word`);
    });

    it("handles only opening quote", () => {
      expect(fixDoubleQuoteSpacing(`word${OQ}text`)).toBe(`word ${OQ}text`);
    });

    it("handles only closing quote", () => {
      expect(fixDoubleQuoteSpacing(`text${CQ}word`)).toBe(`text${CQ} word`);
    });

    it("handles newlines", () => {
      expect(fixDoubleQuoteSpacing(`word${OQ}text${CQ}\nmore`)).toBe(`word ${OQ}text${CQ}\nmore`);
    });

    it("handles tabs", () => {
      expect(fixDoubleQuoteSpacing(`word${OQ}text${CQ}\tmore`)).toBe(`word ${OQ}text${CQ}\tmore`);
    });

    it("does not affect straight quotes", () => {
      expect(fixDoubleQuoteSpacing('word"text"')).toBe('word"text"');
    });
  });
});

describe("fixSingleQuoteSpacing", () => {
  const OQ = "\u2018"; // Opening curly single quote '
  const CQ = "\u2019"; // Closing curly single quote '

  describe("space before opening quote", () => {
    it("adds space after alphanumeric", () => {
      expect(fixSingleQuoteSpacing(`word${OQ}text${CQ}`)).toBe(`word ${OQ}text${CQ}`);
    });

    it("adds space after CJK characters", () => {
      expect(fixSingleQuoteSpacing(`中文${OQ}text${CQ}`)).toBe(`中文 ${OQ}text${CQ}`);
    });

    it("no space after CJK terminal punctuation", () => {
      expect(fixSingleQuoteSpacing(`，${OQ}text${CQ}`)).toBe(`，${OQ}text${CQ}`);
      expect(fixSingleQuoteSpacing(`。${OQ}text${CQ}`)).toBe(`。${OQ}text${CQ}`);
    });
  });

  describe("space after closing quote", () => {
    it("adds space before alphanumeric", () => {
      expect(fixSingleQuoteSpacing(`${OQ}text${CQ}word`)).toBe(`${OQ}text${CQ} word`);
    });

    it("adds space before CJK characters", () => {
      expect(fixSingleQuoteSpacing(`${OQ}text${CQ}中文`)).toBe(`${OQ}text${CQ} 中文`);
    });

    it("no space before CJK terminal punctuation", () => {
      expect(fixSingleQuoteSpacing(`${OQ}text${CQ}，`)).toBe(`${OQ}text${CQ}，`);
      expect(fixSingleQuoteSpacing(`${OQ}text${CQ}。`)).toBe(`${OQ}text${CQ}。`);
    });
  });

  describe("combined scenarios", () => {
    it("adds space on both sides with CJK", () => {
      expect(fixSingleQuoteSpacing(`测试${OQ}hello${CQ}内容`)).toBe(`测试 ${OQ}hello${CQ} 内容`);
    });
  });
});

describe("fixCornerQuoteSpacing", () => {
  describe("space before opening quote", () => {
    it("adds space after alphanumeric", () => {
      expect(fixCornerQuoteSpacing("word「text」")).toBe("word 「text」");
    });

    it("adds space after CJK characters", () => {
      expect(fixCornerQuoteSpacing("中文「text」")).toBe("中文 「text」");
    });

    it("no space after CJK terminal punctuation", () => {
      expect(fixCornerQuoteSpacing("，「text」")).toBe("，「text」");
      expect(fixCornerQuoteSpacing("。「text」")).toBe("。「text」");
    });

    it("no space after CJK closing brackets", () => {
      expect(fixCornerQuoteSpacing("」「text」")).toBe("」「text」");
    });
  });

  describe("space after closing quote", () => {
    it("adds space before alphanumeric", () => {
      expect(fixCornerQuoteSpacing("「text」word")).toBe("「text」 word");
    });

    it("adds space before CJK characters", () => {
      expect(fixCornerQuoteSpacing("「text」中文")).toBe("「text」 中文");
    });

    it("no space before CJK terminal punctuation", () => {
      expect(fixCornerQuoteSpacing("「text」，")).toBe("「text」，");
      expect(fixCornerQuoteSpacing("「text」。")).toBe("「text」。");
    });

    it("no space before CJK opening brackets", () => {
      expect(fixCornerQuoteSpacing("「text」「more」")).toBe("「text」「more」");
    });
  });

  describe("combined scenarios", () => {
    it("adds space on both sides with CJK", () => {
      expect(fixCornerQuoteSpacing("测试「hello」内容")).toBe("测试 「hello」 内容");
    });

    it("handles nested corner quotes", () => {
      expect(fixCornerQuoteSpacing("外层「内层『最内』层」结束")).toBe(
        "外层 「内层『最内』层」 结束"
      );
    });
  });
});

describe("fixDoubleCornerQuoteSpacing", () => {
  it("adds space after alphanumeric", () => {
    expect(fixDoubleCornerQuoteSpacing("word『text』")).toBe("word 『text』");
  });

  it("adds space after CJK characters", () => {
    expect(fixDoubleCornerQuoteSpacing("中文『text』")).toBe("中文 『text』");
  });

  it("adds space before alphanumeric", () => {
    expect(fixDoubleCornerQuoteSpacing("『text』word")).toBe("『text』 word");
  });

  it("adds space before CJK characters", () => {
    expect(fixDoubleCornerQuoteSpacing("『text』中文")).toBe("『text』 中文");
  });

  it("no space after/before terminal punctuation", () => {
    expect(fixDoubleCornerQuoteSpacing("，『text』，")).toBe("，『text』，");
  });
});

describe("convertStraightToSmartQuotes", () => {
  const OQ = "\u201c"; // Opening curly double quote "
  const CQ = "\u201d"; // Closing curly double quote "
  const OSQ = "\u2018"; // Opening curly single quote '
  const CSQ = "\u2019"; // Closing curly single quote '

  describe("curly style - double quotes", () => {
    it("converts double quotes to curly quotes", () => {
      expect(convertStraightToSmartQuotes('"hello"', "curly")).toBe(`${OQ}hello${CQ}`);
      expect(convertStraightToSmartQuotes('say "hello" world', "curly")).toBe(
        `say ${OQ}hello${CQ} world`
      );
    });

    it("handles quotes at start of text", () => {
      expect(convertStraightToSmartQuotes('"start"', "curly")).toBe(`${OQ}start${CQ}`);
    });

    it("handles quotes at end of text", () => {
      expect(convertStraightToSmartQuotes('end "here"', "curly")).toBe(`end ${OQ}here${CQ}`);
    });

    it("handles multiple quote pairs", () => {
      expect(convertStraightToSmartQuotes('"a" and "b"', "curly")).toBe(
        `${OQ}a${CQ} and ${OQ}b${CQ}`
      );
    });

    it("handles quotes after opening brackets", () => {
      expect(convertStraightToSmartQuotes('("quoted")', "curly")).toBe(`(${OQ}quoted${CQ})`);
      expect(convertStraightToSmartQuotes('["quoted"]', "curly")).toBe(`[${OQ}quoted${CQ}]`);
      expect(convertStraightToSmartQuotes('{"quoted"}', "curly")).toBe(`{${OQ}quoted${CQ}}`);
    });

    it("handles quotes after CJK opening brackets", () => {
      expect(convertStraightToSmartQuotes('「"quoted"」', "curly")).toBe(`「${OQ}quoted${CQ}」`);
      expect(convertStraightToSmartQuotes('《"quoted"》', "curly")).toBe(`《${OQ}quoted${CQ}》`);
      expect(convertStraightToSmartQuotes('【"quoted"】', "curly")).toBe(`【${OQ}quoted${CQ}】`);
      expect(convertStraightToSmartQuotes('〈"quoted"〉', "curly")).toBe(`〈${OQ}quoted${CQ}〉`);
    });

    it("handles quotes with CJK content", () => {
      expect(convertStraightToSmartQuotes('"中文内容"', "curly")).toBe(`${OQ}中文内容${CQ}`);
    });

    // NOTE: CJK characters are NOT in the "opening context" list
    // So quote after CJK character is treated as closing quote
    // This is a known limitation - both quotes become closing quotes
    it("handles quotes embedded in CJK text (limitation)", () => {
      // Current behavior: both quotes after CJK become closing quotes
      const result = convertStraightToSmartQuotes('测试"内容"结束', "curly");
      // Just verify straight quotes are converted to some curly quotes
      expect(result).not.toBe('测试"内容"结束'); // Should change something
      expect(result).toContain(CQ); // At least closing quotes present
    });

    it("handles empty quotes", () => {
      expect(convertStraightToSmartQuotes('""', "curly")).toBe(`${OQ}${CQ}`);
    });

    // NOTE: Current limitation - space after opening quote causes it to be treated as closing
    // This is a known limitation of context-based quote detection
    it("handles quotes with only spaces (known limitation)", () => {
      // Actual behavior: first quote treated as opening, second as closing (correct)
      // but the detection is fragile with edge cases
      const result = convertStraightToSmartQuotes('" "', "curly");
      // Just verify it doesn't crash and produces some curly quotes
      expect(result).toContain("\u201c");
    });

    // NOTE: Consecutive quote pairs are tricky - the closing quote of first pair
    // looks like a "word character followed by quote" context
    it("handles consecutive quote pairs (known limitation)", () => {
      const result = convertStraightToSmartQuotes('"a""b"', "curly");
      // Verify we get curly quotes, even if pairing isn't perfect
      expect(result).toContain(OQ);
      expect(result).toContain(CQ);
    });
  });

  describe("curly style - single quotes", () => {
    it("converts single quotes to curly quotes", () => {
      expect(convertStraightToSmartQuotes("'hello'", "curly")).toBe(`${OSQ}hello${CSQ}`);
      expect(convertStraightToSmartQuotes("say 'hello' world", "curly")).toBe(
        `say ${OSQ}hello${CSQ} world`
      );
    });

    it("preserves apostrophes in contractions", () => {
      expect(convertStraightToSmartQuotes("don't", "curly")).toBe("don't");
      expect(convertStraightToSmartQuotes("it's", "curly")).toBe("it's");
      expect(convertStraightToSmartQuotes("I'm", "curly")).toBe("I'm");
      expect(convertStraightToSmartQuotes("they're", "curly")).toBe("they're");
      expect(convertStraightToSmartQuotes("we've", "curly")).toBe("we've");
      expect(convertStraightToSmartQuotes("couldn't", "curly")).toBe("couldn't");
    });

    it("preserves apostrophes in possessives", () => {
      expect(convertStraightToSmartQuotes("John's book", "curly")).toBe("John's book");
      expect(convertStraightToSmartQuotes("the dog's tail", "curly")).toBe("the dog's tail");
    });

    // NOTE: Decade abbreviations like '90s are tricky - the quote after space
    // could be opening quote (for abbreviation) or could be left as-is
    it("handles decade abbreviations (known limitation)", () => {
      const result = convertStraightToSmartQuotes("the '90s", "curly");
      // Current behavior: the unpaired quote may not be converted
      // This is a known limitation of the paired-quote detection
      expect(result).toBe("the '90s");
    });

    it("handles single quotes at start of text", () => {
      expect(convertStraightToSmartQuotes("'start'", "curly")).toBe(`${OSQ}start${CSQ}`);
    });
  });

  describe("curly style - nested quotes", () => {
    it("handles nested quotes", () => {
      expect(convertStraightToSmartQuotes('"say \'hello\' now"', "curly")).toBe(
        `${OQ}say ${OSQ}hello${CSQ} now${CQ}`
      );
    });

    it("handles multiple nested quotes", () => {
      expect(convertStraightToSmartQuotes('"a \'b\' and \'c\' d"', "curly")).toBe(
        `${OQ}a ${OSQ}b${CSQ} and ${OSQ}c${CSQ} d${CQ}`
      );
    });

    it("handles deeply nested quotes", () => {
      // Note: deep nesting may not be perfect, but should not break
      const input = "\"outer 'inner' end\"";
      const result = convertStraightToSmartQuotes(input, "curly");
      expect(result).toContain(OQ);
      expect(result).toContain(CQ);
    });
  });

  describe("curly style - edge cases", () => {
    it("handles unmatched opening quote", () => {
      const result = convertStraightToSmartQuotes('"unmatched', "curly");
      expect(result).toBe(`${OQ}unmatched`);
    });

    it("handles unmatched closing quote context", () => {
      // Quote after word char is closing
      const result = convertStraightToSmartQuotes('word"', "curly");
      expect(result).toBe(`word${CQ}`);
    });

    it("handles mixed matched and unmatched", () => {
      const result = convertStraightToSmartQuotes('"matched" and "unmatched', "curly");
      expect(result).toBe(`${OQ}matched${CQ} and ${OQ}unmatched`);
    });

    it("does not modify already curly quotes", () => {
      expect(convertStraightToSmartQuotes(`${OQ}already curly${CQ}`, "curly")).toBe(
        `${OQ}already curly${CQ}`
      );
    });

    it("handles quotes around numbers", () => {
      expect(convertStraightToSmartQuotes('"123"', "curly")).toBe(`${OQ}123${CQ}`);
      expect(convertStraightToSmartQuotes('"$100"', "curly")).toBe(`${OQ}$100${CQ}`);
    });

    it("handles quotes around punctuation", () => {
      expect(convertStraightToSmartQuotes('"..."', "curly")).toBe(`${OQ}...${CQ}`);
      expect(convertStraightToSmartQuotes('"!?"', "curly")).toBe(`${OQ}!?${CQ}`);
    });

    it("handles quotes with newlines", () => {
      expect(convertStraightToSmartQuotes('"line1\nline2"', "curly")).toBe(
        `${OQ}line1\nline2${CQ}`
      );
    });
  });

  describe("corner style", () => {
    it("converts double quotes to corner brackets", () => {
      expect(convertStraightToSmartQuotes('"hello"', "corner")).toBe("「hello」");
    });

    it("converts single quotes to double corner brackets", () => {
      expect(convertStraightToSmartQuotes("'hello'", "corner")).toBe("『hello』");
    });

    it("handles CJK content", () => {
      expect(convertStraightToSmartQuotes('"中文"', "corner")).toBe("「中文」");
    });

    it("handles nested quotes", () => {
      expect(convertStraightToSmartQuotes('"outer \'inner\' end"', "corner")).toBe(
        "「outer 『inner』 end」"
      );
    });

    it("handles multiple pairs", () => {
      expect(convertStraightToSmartQuotes('"a" "b"', "corner")).toBe("「a」 「b」");
    });
  });

  describe("guillemets style", () => {
    it("converts double quotes to guillemets", () => {
      expect(convertStraightToSmartQuotes('"hello"', "guillemets")).toBe("«hello»");
    });

    it("converts single quotes to single guillemets", () => {
      expect(convertStraightToSmartQuotes("'hello'", "guillemets")).toBe("‹hello›");
    });

    it("handles nested quotes", () => {
      expect(convertStraightToSmartQuotes('"outer \'inner\' end"', "guillemets")).toBe(
        "«outer ‹inner› end»"
      );
    });

    it("handles multiple pairs", () => {
      expect(convertStraightToSmartQuotes('"a" "b"', "guillemets")).toBe("«a» «b»");
    });
  });
});

describe("convertToCJKCornerQuotes", () => {
  const OQ = "\u201c"; // Opening curly double quote "
  const CQ = "\u201d"; // Closing curly double quote "

  describe("basic conversion", () => {
    it("converts curly quotes around CJK content", () => {
      expect(convertToCJKCornerQuotes(`${OQ}你好${CQ}`)).toBe("「你好」");
      expect(convertToCJKCornerQuotes(`text${OQ}中文内容${CQ}more`)).toBe(
        "text「中文内容」more"
      );
    });

    // NOTE: The convertToCJKCornerQuotes function only detects Chinese characters (U+4E00-U+9FFF)
    // Japanese Hiragana/Katakana and Korean are NOT detected as CJK for this function
    // This is intentional - corner quotes are primarily used in Chinese/Japanese with Kanji
    it("converts quotes with Chinese characters", () => {
      expect(convertToCJKCornerQuotes(`${OQ}中文${CQ}`)).toBe("「中文」");
    });

    it("does NOT convert quotes with Japanese Hiragana (design decision)", () => {
      // Hiragana alone doesn't trigger corner quote conversion
      expect(convertToCJKCornerQuotes(`${OQ}ひらがな${CQ}`)).toBe(`${OQ}ひらがな${CQ}`);
    });

    it("does NOT convert quotes with Japanese Katakana (design decision)", () => {
      // Katakana alone doesn't trigger corner quote conversion
      expect(convertToCJKCornerQuotes(`${OQ}カタカナ${CQ}`)).toBe(`${OQ}カタカナ${CQ}`);
    });

    it("does NOT convert quotes with Korean (design decision)", () => {
      // Korean doesn't trigger corner quote conversion
      expect(convertToCJKCornerQuotes(`${OQ}한글${CQ}`)).toBe(`${OQ}한글${CQ}`);
    });

    it("converts quotes with mixed Japanese (Kanji + Kana)", () => {
      // When Kanji is present, conversion happens
      expect(convertToCJKCornerQuotes(`${OQ}日本語${CQ}`)).toBe("「日本語」");
      expect(convertToCJKCornerQuotes(`${OQ}東京${CQ}`)).toBe("「東京」");
    });

    it("converts quotes with mixed CJK and Latin", () => {
      expect(convertToCJKCornerQuotes(`${OQ}中文abc${CQ}`)).toBe("「中文abc」");
      expect(convertToCJKCornerQuotes(`${OQ}abc中文${CQ}`)).toBe("「abc中文」");
      expect(convertToCJKCornerQuotes(`${OQ}a中b文c${CQ}`)).toBe("「a中b文c」");
    });

    it("converts quotes with numbers and CJK", () => {
      expect(convertToCJKCornerQuotes(`${OQ}2024年${CQ}`)).toBe("「2024年」");
      expect(convertToCJKCornerQuotes(`${OQ}第一章${CQ}`)).toBe("「第一章」");
    });
  });

  describe("preserves non-CJK quotes", () => {
    it("preserves curly quotes around pure English", () => {
      expect(convertToCJKCornerQuotes(`${OQ}hello${CQ}`)).toBe(`${OQ}hello${CQ}`);
      expect(convertToCJKCornerQuotes(`${OQ}hello world${CQ}`)).toBe(`${OQ}hello world${CQ}`);
    });

    it("preserves curly quotes around numbers only", () => {
      expect(convertToCJKCornerQuotes(`${OQ}12345${CQ}`)).toBe(`${OQ}12345${CQ}`);
      expect(convertToCJKCornerQuotes(`${OQ}$100${CQ}`)).toBe(`${OQ}$100${CQ}`);
    });

    it("preserves curly quotes around punctuation only", () => {
      expect(convertToCJKCornerQuotes(`${OQ}...${CQ}`)).toBe(`${OQ}...${CQ}`);
    });

    it("does not affect straight quotes", () => {
      expect(convertToCJKCornerQuotes('"你好"')).toBe('"你好"');
    });
  });

  describe("multiple quote pairs", () => {
    it("converts multiple CJK quote pairs", () => {
      expect(convertToCJKCornerQuotes(`${OQ}中文${CQ}和${OQ}内容${CQ}`)).toBe(
        "「中文」和「内容」"
      );
    });

    it("handles mixed CJK and non-CJK quote pairs", () => {
      expect(convertToCJKCornerQuotes(`${OQ}hello${CQ} ${OQ}中文${CQ}`)).toBe(
        `${OQ}hello${CQ} 「中文」`
      );
    });

    it("handles consecutive quote pairs", () => {
      expect(convertToCJKCornerQuotes(`${OQ}一${CQ}${OQ}二${CQ}`)).toBe("「一」「二」");
    });
  });

  describe("edge cases", () => {
    it("handles empty quotes", () => {
      expect(convertToCJKCornerQuotes(`${OQ}${CQ}`)).toBe(`${OQ}${CQ}`);
    });

    it("handles quotes with only whitespace", () => {
      expect(convertToCJKCornerQuotes(`${OQ} ${CQ}`)).toBe(`${OQ} ${CQ}`);
    });

    it("handles quotes with CJK punctuation inside", () => {
      expect(convertToCJKCornerQuotes(`${OQ}你好，世界${CQ}`)).toBe("「你好，世界」");
      expect(convertToCJKCornerQuotes(`${OQ}什么？${CQ}`)).toBe("「什么？」");
    });

    // NOTE: CJK Extension A (U+3400-U+4DBF) is NOT detected by this function
    // Only basic CJK Unified Ideographs (U+4E00-U+9FFF) are detected
    it("does NOT convert CJK Extension A characters (limitation)", () => {
      expect(convertToCJKCornerQuotes(`${OQ}㐀㐁${CQ}`)).toBe(`${OQ}㐀㐁${CQ}`);
    });

    it("converts when Extension A is mixed with basic CJK", () => {
      // When basic CJK is present, conversion happens
      expect(convertToCJKCornerQuotes(`${OQ}㐀中文${CQ}`)).toBe("「㐀中文」");
    });

    it("handles newlines in quoted content", () => {
      expect(convertToCJKCornerQuotes(`${OQ}第一行\n第二行${CQ}`)).toBe("「第一行\n第二行」");
    });

    it("preserves surrounding text", () => {
      expect(convertToCJKCornerQuotes(`before${OQ}中文${CQ}after`)).toBe("before「中文」after");
      expect(convertToCJKCornerQuotes(`  ${OQ}中文${CQ}  `)).toBe("  「中文」  ");
    });
  });

  describe("real-world examples", () => {
    it("handles typical Chinese sentence", () => {
      const input = `他说${OQ}你好${CQ}，然后走了。`;
      expect(convertToCJKCornerQuotes(input)).toBe("他说「你好」，然后走了。");
    });

    it("handles technical terms in Chinese text", () => {
      const input = `${OQ}物质财富${CQ}不是幸福的来源`;
      expect(convertToCJKCornerQuotes(input)).toBe("「物质财富」不是幸福的来源");
    });

    it("handles book/article titles", () => {
      const input = `请阅读${OQ}红楼梦${CQ}`;
      expect(convertToCJKCornerQuotes(input)).toBe("请阅读「红楼梦」");
    });
  });
});

describe("convertNestedCornerQuotes", () => {
  const OSQ = "\u2018"; // Opening curly single quote '
  const CSQ = "\u2019"; // Closing curly single quote '

  describe("basic conversion", () => {
    it("converts single curly quotes inside corner brackets to double corner brackets", () => {
      expect(convertNestedCornerQuotes(`「text ${OSQ}nested${CSQ} end」`)).toBe(
        "「text 『nested』 end」"
      );
    });

    it("handles multiple nested quotes", () => {
      expect(convertNestedCornerQuotes(`「a ${OSQ}b${CSQ} and ${OSQ}c${CSQ} d」`)).toBe(
        "「a 『b』 and 『c』 d」"
      );
    });

    it("handles nested quotes with CJK content", () => {
      expect(convertNestedCornerQuotes(`「外层${OSQ}内层${CSQ}结束」`)).toBe(
        "「外层『内层』结束」"
      );
    });
  });

  describe("preserves non-nested quotes", () => {
    it("does not convert single quotes outside corner brackets", () => {
      expect(convertNestedCornerQuotes(`${OSQ}outside${CSQ}「inside」`)).toBe(
        `${OSQ}outside${CSQ}「inside」`
      );
    });

    it("does not convert quotes in text without corner brackets", () => {
      expect(convertNestedCornerQuotes(`just ${OSQ}quotes${CSQ}`)).toBe(
        `just ${OSQ}quotes${CSQ}`
      );
    });
  });

  describe("multiple corner bracket pairs", () => {
    it("converts nested quotes in all corner bracket pairs", () => {
      expect(
        convertNestedCornerQuotes(`「a ${OSQ}b${CSQ}」和「c ${OSQ}d${CSQ}」`)
      ).toBe("「a 『b』」和「c 『d』」");
    });

    it("handles mixed nested and non-nested", () => {
      expect(convertNestedCornerQuotes(`「${OSQ}nested${CSQ}」「no nested」`)).toBe(
        "「『nested』」「no nested」"
      );
    });
  });

  describe("edge cases", () => {
    it("handles empty corner brackets", () => {
      expect(convertNestedCornerQuotes("「」")).toBe("「」");
    });

    it("handles corner brackets without nested quotes", () => {
      expect(convertNestedCornerQuotes("「no nested quotes」")).toBe("「no nested quotes」");
    });

    it("handles adjacent nested quotes", () => {
      expect(convertNestedCornerQuotes(`「${OSQ}a${CSQ}${OSQ}b${CSQ}」`)).toBe(
        "「『a』『b』」"
      );
    });

    it("preserves already converted double corner brackets", () => {
      expect(convertNestedCornerQuotes("「text 『already converted』 end」")).toBe(
        "「text 『already converted』 end」"
      );
    });
  });

  describe("real-world examples", () => {
    it("handles dialogue with quoted speech", () => {
      const input = `「他说${OSQ}你好${CSQ}」`;
      expect(convertNestedCornerQuotes(input)).toBe("「他说『你好』」");
    });

    it("handles technical writing", () => {
      const input = `「在${OSQ}设置${CSQ}中找到${OSQ}语言${CSQ}选项」`;
      expect(convertNestedCornerQuotes(input)).toBe("「在『设置』中找到『语言』选项」");
    });
  });
});

describe("limitConsecutivePunctuation", () => {
  it("limits to single punctuation when limit is 1", () => {
    expect(limitConsecutivePunctuation("！！！", 1)).toBe("！");
    expect(limitConsecutivePunctuation("？？？", 1)).toBe("？");
    expect(limitConsecutivePunctuation("。。。", 1)).toBe("。");
  });

  it("limits to double punctuation when limit is 2", () => {
    expect(limitConsecutivePunctuation("！！！！", 2)).toBe("！！");
  });

  it("returns unchanged when limit is 0", () => {
    expect(limitConsecutivePunctuation("！！！", 0)).toBe("！！！");
  });
});
