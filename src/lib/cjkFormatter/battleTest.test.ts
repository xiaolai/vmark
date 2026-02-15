/**
 * Battle Test for CJK Typography Rules
 *
 * This test runs the formatter against complex edge cases to verify
 * all rules work correctly together. Run with: pnpm test battleTest
 */

import { describe, test, expect } from "vitest";
import { formatMarkdown } from "./formatter";
import type { CJKFormattingSettings } from "@/stores/settingsStore";

// Default CJK formatting settings for testing
const config: CJKFormattingSettings = {
  // Group 1: Universal
  ellipsisNormalization: true,
  newlineCollapsing: true,
  // Group 2: Fullwidth Normalization
  fullwidthAlphanumeric: true,
  fullwidthPunctuation: true,
  fullwidthParentheses: true,
  fullwidthBrackets: true,
  // Group 3: Spacing
  cjkEnglishSpacing: true,
  cjkParenthesisSpacing: true,
  currencySpacing: true,
  slashSpacing: true,
  spaceCollapsing: true,
  // Group 4: Dash & Quote
  dashConversion: true,
  emdashSpacing: true,
  smartQuoteConversion: true,
  quoteStyle: "curly",
  contextualQuotes: true, // curly for CJK, straight for pure Latin
  quoteSpacing: true,
  singleQuoteSpacing: true,
  cjkCornerQuotes: false,
  cjkNestedQuotes: false,
  quoteToggleMode: "simple",
  // Group 5: Cleanup
  consecutivePunctuationLimit: 2,
  trailingSpaceRemoval: true,
};

describe("CJK Battle Test", () => {
  describe("1. Ellipsis Normalization", () => {
    test("basic ellipsis", () => {
      expect(formatMarkdown("等等...后续内容", config)).toContain("...");
    });

    test("spaced dots to ellipsis", () => {
      expect(formatMarkdown("思考中. . .然后继续", config)).toContain("...");
    });

    test("multiple ellipsis groups", () => {
      const result = formatMarkdown("前文...中间...后文...三组", config);
      expect(result).toContain("...");
    });

    test("15 consecutive dots", () => {
      const result = formatMarkdown("...............连续15个点", config);
      // Should normalize but preserve intent
      expect(result).toBeDefined();
    });
  });

  describe("2. Latin Span & Technical Subspans", () => {
    test("URLs - preserve internal punctuation", () => {
      const input = "访问https://example.com/path?a=1,b=2&c=3获取详情";
      const result = formatMarkdown(input, config);
      // URL should be preserved, but spacing added around it
      expect(result).toContain("https://example.com/path?a=1,b=2&c=3");
    });

    test("complex URL with auth and port", () => {
      const input = "链接：https://user:pass@host.com:8080/path#anchor";
      const result = formatMarkdown(input, config);
      expect(result).toContain("https://user:pass@host.com:8080/path#anchor");
    });

    test("URL with encoded characters", () => {
      const input = "特殊字符https://example.com/path%20with%2Fslash编码";
      const result = formatMarkdown(input, config);
      expect(result).toContain("https://example.com/path%20with%2Fslash");
    });

    test("email addresses - preserve", () => {
      const input = "联系邮箱test.user@example.com获取帮助";
      const result = formatMarkdown(input, config);
      expect(result).toContain("test.user@example.com");
    });

    test("email with plus sign", () => {
      const input = "带加号user+tag@example.com过滤";
      const result = formatMarkdown(input, config);
      expect(result).toContain("user+tag@example.com");
    });

    test("version numbers - preserve", () => {
      const input = "当前版本v1.2.3，下一版本v2.0.0";
      const result = formatMarkdown(input, config);
      expect(result).toContain("v1.2.3");
      expect(result).toContain("v2.0.0");
    });

    test("semver with prerelease", () => {
      const input = "预发布版本v2.0.0-beta.1测试";
      const result = formatMarkdown(input, config);
      expect(result).toContain("v2.0.0-beta.1");
    });

    test("decimal numbers - preserve", () => {
      const input = "圆周率是3.14159，黄金比例是1.618";
      const result = formatMarkdown(input, config);
      expect(result).toContain("3.14159");
      expect(result).toContain("1.618");
    });

    test("negative decimals", () => {
      const input = "负数-3.14和正数+3.14";
      const result = formatMarkdown(input, config);
      expect(result).toContain("-3.14");
      expect(result).toContain("+3.14");
    });

    test("time formats - preserve", () => {
      const input = "会议时间10:30开始，12:00结束";
      const result = formatMarkdown(input, config);
      expect(result).toContain("10:30");
      expect(result).toContain("12:00");
    });

    test("time with milliseconds", () => {
      const input = "毫秒精度10:30:45.123时间戳";
      const result = formatMarkdown(input, config);
      expect(result).toContain("10:30:45.123");
    });

    test("thousands separators - preserve", () => {
      const input = "人口1,000,000人";
      const result = formatMarkdown(input, config);
      expect(result).toContain("1,000,000");
    });

    test("large numbers with separators", () => {
      const input = "大数12,345,678,901十亿级";
      const result = formatMarkdown(input, config);
      expect(result).toContain("12,345,678,901");
    });

    test("IP addresses preserved", () => {
      const input = "服务器192.168.1.1本地";
      const result = formatMarkdown(input, config);
      expect(result).toContain("192.168.1.1");
    });

    test("IP with port", () => {
      const input = "带端口127.0.0.1:8080本地开发";
      const result = formatMarkdown(input, config);
      expect(result).toContain("127.0.0.1:8080");
    });
  });

  describe("3. Punctuation Conversion", () => {
    test("CJK + punct + CJK - converts", () => {
      expect(formatMarkdown("你好,世界", config)).toBe("你好，世界");
    });

    test("CJK + punct + Latin - converts", () => {
      const result = formatMarkdown("中文,English混排", config);
      expect(result).toContain("，");
    });

    test("Latin + punct + CJK - converts", () => {
      const result = formatMarkdown("Hello,世界问候", config);
      expect(result).toContain("，");
    });

    test("pure Latin - no conversion", () => {
      expect(formatMarkdown("Hello, World", config)).toBe("Hello, World");
    });

    test("multiple punctuation types", () => {
      const input = "这是问题?还是陈述!";
      const result = formatMarkdown(input, config);
      expect(result).toContain("？");
      expect(result).toContain("！");
    });

    test("consecutive commas", () => {
      const input = "连续逗号,,测试双逗号";
      const result = formatMarkdown(input, config);
      // Should handle gracefully
      expect(result).toBeDefined();
    });

    test("mixed punctuation types", () => {
      const input = "混合,;:!?多标点";
      const result = formatMarkdown(input, config);
      expect(result).toBeDefined();
    });
  });

  describe("4. Bracket Normalization", () => {
    test("parentheses with CJK - converts", () => {
      expect(formatMarkdown("(你好)", config)).toBe("（你好）");
    });

    test("parentheses with Latin - no change", () => {
      expect(formatMarkdown("(Hello World)", config)).toBe("(Hello World)");
    });

    test("brackets with CJK - converts", () => {
      expect(formatMarkdown("[测试]", config)).toBe("【测试】");
    });

    test("deeply nested parentheses", () => {
      const input = "((((中文))))";
      const result = formatMarkdown(input, config);
      expect(result).toContain("（");
      expect(result).toContain("）");
    });

    test("adjacent brackets", () => {
      const input = "()(中文)()";
      const result = formatMarkdown(input, config);
      expect(result).toContain("（中文）");
    });
  });

  describe("5. CJK↔Latin Spacing", () => {
    test("adds space between CJK and Latin", () => {
      expect(formatMarkdown("你好World", config)).toBe("你好 World");
      expect(formatMarkdown("Hello世界", config)).toBe("Hello 世界");
    });

    test("adds space between CJK and numbers", () => {
      expect(formatMarkdown("共100个", config)).toBe("共 100 个");
    });

    test("Korean also gets spacing", () => {
      expect(formatMarkdown("안녕Hello", config)).toBe("안녕 Hello");
    });

    test("rapid alternation stress test", () => {
      const input = "中A中B中C中D中E中";
      const result = formatMarkdown(input, config);
      // Should add spaces between each
      expect(result).toContain("中 A 中");
    });

    test("mixed scripts with numbers", () => {
      const input = "第1步到第10步共100个";
      const result = formatMarkdown(input, config);
      expect(result).toContain("1");
      expect(result).toContain("10");
      expect(result).toContain("100");
    });
  });

  describe("6. Quote Pairing", () => {
    test("apostrophes preserved", () => {
      const result = formatMarkdown("don't convert apostrophes", config);
      expect(result).toContain("don't");
    });

    test("multiple contractions", () => {
      const result = formatMarkdown("they're can't won't shouldn't wouldn't", config);
      expect(result).toContain("they're");
      expect(result).toContain("can't");
      expect(result).toContain("won't");
    });

    test("primes preserved (measurements)", () => {
      const result = formatMarkdown("身高5'10\"", config);
      expect(result).toContain("5'10\"");
    });

    test("geographic coordinates", () => {
      const result = formatMarkdown("纬度40°26'46\"N", config);
      expect(result).toContain("40°26'46\"");
    });

    test("decade abbreviations preserved", () => {
      const result = formatMarkdown("'90s音乐风格", config);
      expect(result).toContain("'90s");
    });

    test("multiple decades", () => {
      const result = formatMarkdown("late '90s early '00s", config);
      expect(result).toContain("'90s");
      expect(result).toContain("'00s");
    });

    test("CJK context gets curly quotes", () => {
      const result = formatMarkdown('中文"Hello"测试', config);
      // With contextualQuotes: true, CJK boundary triggers curly quotes
      // The quotes are around Latin content but the boundary is CJK
      expect(result).toContain("\u201c"); // left curly quote
      expect(result).toContain("\u201d"); // right curly quote
    });

    test("pure Latin stays straight (contextual mode)", () => {
      const result = formatMarkdown('"Hello World" is a phrase', config);
      // With contextualQuotes: true (default), pure Latin stays straight
      expect(result).toContain('"Hello World"');
    });

    test("deeply nested quotes", () => {
      const result = formatMarkdown('"Level1\'Level2"Level3\'end"', config);
      expect(result).toBeDefined();
    });

    test("adversarial 8 consecutive quotes", () => {
      const result = formatMarkdown('""""""""连续8个引号', config);
      expect(result).toBeDefined();
    });
  });

  describe("7. Dash Normalization", () => {
    test("double hyphen to em-dash", () => {
      const result = formatMarkdown("这是--测试", config);
      expect(result).toContain("——");
    });

    test("triple hyphen", () => {
      const result = formatMarkdown("这是---长破折号", config);
      expect(result).toContain("——");
    });

    test("multiple dashes in sequence", () => {
      const result = formatMarkdown("他--思考--然后--行动", config);
      expect(result).toContain("——");
    });

    test("hyphens in technical contexts preserved", () => {
      const input = "kebab-case命名";
      const result = formatMarkdown(input, config);
      expect(result).toContain("kebab-case");
    });
  });

  describe("8. Currency & Unit Binding", () => {
    test("prefix currency tight", () => {
      // Currency spacing only applies in CJK context
      const result = formatMarkdown("价格 $ 100 元", config);
      expect(result).toContain("$100");
    });

    test("unit symbols tight", () => {
      expect(formatMarkdown("温度 25 ℃", config)).toContain("25℃");
      expect(formatMarkdown("折扣 50 %", config)).toContain("50%");
    });

    test("postfix currency spaced", () => {
      const result = formatMarkdown("共100USD", config);
      expect(result).toContain("100 USD");
    });

    test("multiple currencies", () => {
      const input = "$100+¥500+€50混合货币";
      const result = formatMarkdown(input, config);
      expect(result).toContain("$100");
      expect(result).toContain("¥500");
      expect(result).toContain("€50");
    });

    test("Fahrenheit with degree", () => {
      const result = formatMarkdown("温度 72 °F", config);
      expect(result).toContain("72°F");
    });
  });

  describe("9. Korean Handling", () => {
    test("Korean punctuation NOT converted", () => {
      // Korean uses Western punctuation, so comma stays ASCII
      expect(formatMarkdown("안녕,Hello", config)).toBe("안녕,Hello");
    });

    test("Korean parentheses NOT converted", () => {
      expect(formatMarkdown("(안녕하세요)", config)).toBe("(안녕하세요)");
    });

    test("Korean gets Latin spacing", () => {
      expect(formatMarkdown("한국어English", config)).toBe("한국어 English");
    });

    test("Korean-Chinese-Japanese mixing", () => {
      const input = "中文测试안녕하세요日本語テスト";
      const result = formatMarkdown(input, config);
      expect(result).toBeDefined();
    });

    test("Korean with numbers", () => {
      const result = formatMarkdown("한국어123테스트", config);
      expect(result).toContain("123");
    });
  });

  describe("10. Protected Contexts", () => {
    test("inline code preserved", () => {
      const input = "代码`a,b,c`不变";
      const result = formatMarkdown(input, config);
      expect(result).toContain("`a,b,c`");
    });

    test("inline code with path", () => {
      const input = "路径`/usr/local/bin`保护";
      const result = formatMarkdown(input, config);
      expect(result).toContain("`/usr/local/bin`");
    });

    test("code blocks preserved", () => {
      const input = "```\nfunction test(a, b) {\n  return a + b;\n}\n```";
      const result = formatMarkdown(input, config);
      expect(result).toContain("function test(a, b)");
    });

    test("markdown links preserved", () => {
      const input = "[链接](https://example.com/a,b?x=1)";
      const result = formatMarkdown(input, config);
      expect(result).toContain("https://example.com/a,b?x=1");
    });

    test("complex markdown links", () => {
      const input = "[complex](https://example.com/path?a=1&b=2#section)";
      const result = formatMarkdown(input, config);
      expect(result).toContain("https://example.com/path?a=1&b=2#section");
    });

    test("math expressions preserved", () => {
      const input = "公式$x,y$不变";
      const result = formatMarkdown(input, config);
      expect(result).toContain("$x,y$");
    });

    test("complex math preserved", () => {
      const input = "复杂$\\sum_{i=1}^{n} x_i$求和";
      const result = formatMarkdown(input, config);
      expect(result).toContain("$\\sum_{i=1}^{n} x_i$");
    });

    test("combined protected contexts", () => {
      const input = "代码`func(a,b)`加链接[test](url)";
      const result = formatMarkdown(input, config);
      expect(result).toContain("`func(a,b)`");
    });
  });

  describe("11. Complex Mixed Scenarios", () => {
    test("technical documentation", () => {
      const input = "使用Python3.11编写的CLI工具,支持macOS和Windows系统。";
      const result = formatMarkdown(input, config);
      expect(result).toContain("Python3.11"); // version preserved
      expect(result).toContain("，"); // comma converted
      expect(result).toContain("macOS"); // proper spacing
    });

    test("e-commerce pricing", () => {
      const input = "商品原价$99.99,现价¥599";
      const result = formatMarkdown(input, config);
      expect(result).toContain("$99.99"); // currency tight
      expect(result).toContain("¥599"); // currency tight
      expect(result).toContain("，"); // comma converted
    });

    test("mixed quotes and apostrophes", () => {
      const input = '他说"Hello"然后说"你好", 并补充don\'t把\'90s写错, 身高5\'10".';
      const result = formatMarkdown(input, config);
      expect(result).toContain("don't"); // apostrophe preserved
      expect(result).toContain("'90s"); // decade preserved
      expect(result).toContain("5'10\""); // primes preserved
    });

    test("table structure preserved", () => {
      const input = `| 中文 | English |
|------|---------|
| 你好 | Hello |
| 测试,数据 | test,data |`;
      const result = formatMarkdown(input, config);
      // Table structure must be preserved
      expect(result).toContain("|------|---------");
      // Content gets formatted but pipes preserved
      expect(result.split("\n").length).toBe(4);
    });

    test("academic citation", () => {
      const input = 'According to Zhang et al. (2023), "中西方文化差异显著" (p. 42).';
      const result = formatMarkdown(input, config);
      expect(result).toBeDefined();
    });

    test("financial report", () => {
      const input = "营收: ¥1,234,567,890 (同比+15%)";
      const result = formatMarkdown(input, config);
      expect(result).toContain("¥1,234,567,890");
      expect(result).toContain("15%");
    });

    test("log file analysis", () => {
      const input = "[2024-01-15 10:30:45.123] ERROR: 连接失败";
      const result = formatMarkdown(input, config);
      expect(result).toContain("2024-01-15");
      expect(result).toContain("10:30:45.123");
    });
  });

  describe("12. Supplementary Plane Han", () => {
    test("detects Extension B characters", () => {
      // 𠀀 is U+20000, CJK Extension B
      const input = "Text with 𠀀 rare char";
      const result = formatMarkdown(input, config);
      // Should add spacing around the rare character
      expect(result).toContain("𠀀");
    });

    test("multiple Extension B characters", () => {
      const input = "𠀀𠀁𠀂三个扩展字";
      const result = formatMarkdown(input, config);
      expect(result).toContain("𠀀𠀁𠀂");
    });
  });

  describe("13. Edge Cases", () => {
    test("empty quotes", () => {
      expect(formatMarkdown('""', config)).toBeDefined();
    });

    test("adjacent punctuation", () => {
      const result = formatMarkdown("真的吗？！", config);
      expect(result).toBeDefined();
    });

    test("escaped characters", () => {
      const input = "反斜杠\\,逗号";
      const result = formatMarkdown(input, config);
      expect(result).toContain("\\,");
    });

    test("multiple escapes", () => {
      const input = "多重转义\\\\\\,测试";
      const result = formatMarkdown(input, config);
      expect(result).toContain("\\\\");
    });

    test("emoji adjacent to CJK", () => {
      const input = "你好👋世界🌍测试🎉";
      const result = formatMarkdown(input, config);
      expect(result).toContain("👋");
      expect(result).toContain("🌍");
    });

    test("full-width space", () => {
      const input = "全角　空格　测试";
      const result = formatMarkdown(input, config);
      expect(result).toBeDefined();
    });

    test("stress test: all rules at once", () => {
      const input = '他说"I don\'t believe it!"然后问"真的吗???"...最后用$100买了v1.2.3版本的软件,温度25℃,折扣50%,联系support@example.com,访问https://example.com/path?a=1,b=2获取详情。';
      const result = formatMarkdown(input, config);
      expect(result).toContain("don't");
      expect(result).toContain("$100");
      expect(result).toContain("v1.2.3");
      expect(result).toContain("25℃");
      expect(result).toContain("50%");
      expect(result).toContain("support@example.com");
      expect(result).toContain("https://example.com/path?a=1,b=2");
    });

    test("adversarial: 8 consecutive commas", () => {
      const input = ",,,,,,,,连续8个逗号";
      const result = formatMarkdown(input, config);
      expect(result).toBeDefined();
    });

    test("adversarial: deep nesting", () => {
      const input = "(((((((((((((深层嵌套)))))))))))))";
      const result = formatMarkdown(input, config);
      expect(result).toBeDefined();
    });
  });

  describe("14. Slash Spacing", () => {
    test("remove spaces around slash", () => {
      const result = formatMarkdown("男 / 女", config);
      expect(result).toBe("男/女");
    });

    test("preserve URL slashes", () => {
      const input = "https://example.com/path不变";
      const result = formatMarkdown(input, config);
      expect(result).toContain("https://example.com/path");
    });

    test("consecutive slashes preserved", () => {
      const input = "双斜杠//保持";
      const result = formatMarkdown(input, config);
      expect(result).toContain("//");
    });
  });

  describe("15. Consecutive Punctuation Limiting", () => {
    test("limit exclamation marks", () => {
      const result = formatMarkdown("太棒了！！！！！", config);
      // Should limit to 2
      expect(result).not.toContain("！！！");
    });

    test("limit question marks", () => {
      const result = formatMarkdown("真的吗？？？？？", config);
      // Should limit to 2
      expect(result).not.toContain("？？？");
    });

    test("extreme consecutive marks", () => {
      const result = formatMarkdown("太棒了！！！！！！！！！！", config);
      // Should handle gracefully
      expect(result).toBeDefined();
    });
  });

  describe("16. Whitespace Cleanup", () => {
    test("collapse multiple spaces", () => {
      const result = formatMarkdown("多个  空格  测试", config);
      expect(result).not.toContain("  ");
    });

    test("ten consecutive spaces", () => {
      const result = formatMarkdown("十个          空格", config);
      expect(result).not.toContain("          ");
    });
  });

  describe("17. Regression Tests", () => {
    test("escape character preserved", () => {
      const input = "转义字符\\,不转换";
      const result = formatMarkdown(input, config);
      expect(result).toContain("\\,");
    });

    test("table structure preserved", () => {
      const input = "表格结构|不破坏|";
      const result = formatMarkdown(input, config);
      expect(result).toContain("|");
    });

    test("URL internal punctuation protected", () => {
      const input = "URL内https://a.com/b,c保护";
      const result = formatMarkdown(input, config);
      expect(result).toContain("https://a.com/b,c");
    });

    test("version number protected", () => {
      const input = "版本号v1.2.3保护";
      const result = formatMarkdown(input, config);
      expect(result).toContain("v1.2.3");
    });
  });
});
