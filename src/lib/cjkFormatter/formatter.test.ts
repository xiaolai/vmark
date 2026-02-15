import { describe, it, expect } from "vitest";
import type { CJKFormattingSettings } from "@/stores/settingsStore";
import { formatMarkdown } from "./formatter";

function makeConfig(partial: Partial<CJKFormattingSettings> = {}): CJKFormattingSettings {
  return {
    // Group 1
    ellipsisNormalization: false,
    newlineCollapsing: false,
    // Group 2
    fullwidthAlphanumeric: false,
    fullwidthPunctuation: true,
    fullwidthParentheses: true,
    fullwidthBrackets: true,
    // Group 3
    cjkEnglishSpacing: true,
    cjkParenthesisSpacing: true,
    currencySpacing: true,
    slashSpacing: true,
    spaceCollapsing: false,
    // Group 4
    dashConversion: false,
    emdashSpacing: false,
    smartQuoteConversion: false,
    quoteStyle: "curly",
    contextualQuotes: false,
    quoteSpacing: false,
    singleQuoteSpacing: false,
    cjkCornerQuotes: false,
    cjkNestedQuotes: false,
    quoteToggleMode: "simple",
    // Group 5
    consecutivePunctuationLimit: 0,
    trailingSpaceRemoval: false,
    ...partial,
  };
}

describe("cjkFormatter.formatMarkdown (table-safe)", () => {
  it("formats content inside table cells without changing table delimiters", () => {
    const input = [
      "| 中文Python3，内容 | English, text |",
      "| --- | --- |",
      "| 数据,内容 | code `中文Python3` and 中文Python3 |",
      "",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Delimiter row stays unchanged
    expect(out).toContain("\n| --- | --- |\n");
    // CJK↔Latin spacing inside first header cell
    expect(out).toContain("| 中文 Python3，内容 |");
    // CJK punctuation conversion inside a cell (comma between CJK)
    expect(out).toContain("| 数据，内容 |");
    // Inline code must not be formatted
    expect(out).toContain("`中文Python3`");
    // Outside inline code, spacing should apply
    expect(out).toContain("and 中文 Python3 |");
  });

  it("does not split on pipes inside inline code in table cells", () => {
    const input = [
      "> | 中文Python | `a|b` |",
      "> | --- | --- |",
      "> | 中文Python | `x|y` and 中文Python |",
      "",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("> | 中文 Python | `a|b` |");
    expect(out).toContain("> | --- | --- |");
    expect(out).toContain("> | 中文 Python | `x|y` and 中文 Python |");
  });

  it("preserves horizontal rules (thematic breaks)", () => {
    const input = [
      "这是一段文字",
      "",
      "---",
      "",
      "这是另一段文字",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Horizontal rule must be preserved
    expect(out).toContain("\n---\n");
    expect(out).toContain("这是一段文字");
    expect(out).toContain("这是另一段文字");
  });

  it("preserves horizontal rules even with dashConversion enabled", () => {
    const input = [
      "这是一段文字",
      "",
      "---",
      "",
      "这是另一段文字",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig({ dashConversion: true }));

    // Horizontal rule must NOT be converted to em-dash
    expect(out).toContain("\n---\n");
    expect(out).not.toContain("——");
  });

  it("preserves alternative horizontal rule formats", () => {
    const input = [
      "文字",
      "",
      "***",
      "",
      "更多文字",
      "",
      "___",
      "",
      "结束",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("\n***\n");
    expect(out).toContain("\n___\n");
  });
});

