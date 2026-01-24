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
  convertToCJKCornerQuotes,
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
  it("removes space between currency symbol and number", () => {
    expect(fixCurrencySpacing("$ 100")).toBe("$100");
    expect(fixCurrencySpacing("¥ 500")).toBe("¥500");
    expect(fixCurrencySpacing("USD 200")).toBe("USD200");
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
  it("adds space before opening quote after alphanumeric", () => {
    expect(fixDoubleQuoteSpacing("word\u201ctext\u201d")).toBe(
      "word \u201ctext\u201d"
    );
  });

  it("adds space after closing quote before alphanumeric", () => {
    expect(fixDoubleQuoteSpacing("\u201ctext\u201dword")).toBe(
      "\u201ctext\u201d word"
    );
  });

  it("adds space around curly quotes with CJK", () => {
    expect(fixDoubleQuoteSpacing("测试\u201chello\u201d内容")).toBe(
      "测试 \u201chello\u201d 内容"
    );
  });
});

describe("convertToCJKCornerQuotes", () => {
  // Note: Uses curly quotes \u201c (") and \u201d (")
  it("converts curly quotes around CJK content", () => {
    expect(convertToCJKCornerQuotes("\u201c你好\u201d")).toBe("「你好」");
    expect(convertToCJKCornerQuotes("text\u201c中文内容\u201dmore")).toBe(
      "text「中文内容」more"
    );
  });

  it("preserves curly quotes around non-CJK content", () => {
    expect(convertToCJKCornerQuotes("\u201chello\u201d")).toBe(
      "\u201chello\u201d"
    );
  });

  it("does not affect straight quotes", () => {
    expect(convertToCJKCornerQuotes('"你好"')).toBe('"你好"');
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
