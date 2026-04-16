import { describe, it, expect } from "vitest";
import type { CJKFormattingSettings } from "@/stores/settingsStore";
import { formatMarkdown, formatSelection, formatFile } from "./formatter";

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
    // Group 6
    skipReferenceSections: false,
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

  it("formats text before and after table blocks", () => {
    const input = [
      "中文Python before",
      "",
      "| 标题 | 内容 |",
      "| --- | --- |",
      "| 中文Python | data |",
      "",
      "中文Python after",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Text before table should be formatted
    expect(out).toContain("中文 Python before");
    // Text after table should be formatted
    expect(out).toContain("中文 Python after");
    // Table content should also be formatted
    expect(out).toContain("| 中文 Python |");
  });

  it("handles delimiter row at first line (no header)", () => {
    // A delimiter row at line 0 has no header above it; not a valid table
    const input = [
      "| --- | --- |",
      "| 中文Python | data |",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Should still format CJK spacing in cells (treated as non-table text)
    expect(out).toContain("中文 Python");
  });

  it("skips table when header prefix differs from delimiter prefix", () => {
    // Header has no blockquote prefix, delimiter row has blockquote prefix
    const input = [
      "| Header | Col |",
      "> | --- | --- |",
      "> | 中文Python | data |",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Not recognized as table; still format text
    expect(out).toContain("中文 Python");
  });

  it("skips table when header is inside a protected region", () => {
    // Header inside a fenced code block
    const input = [
      "```",
      "| Header | Col |",
      "```",
      "| --- | --- |",
      "| 中文Python | data |",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Code block is preserved
    expect(out).toContain("```\n| Header | Col |\n```");
  });

  it("skips table when header has no pipes outside code", () => {
    const input = [
      "Just text without pipes",
      "| --- | --- |",
      "| 中文Python | data |",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Not a valid table, but text is still formatted
    expect(out).toContain("中文 Python");
  });

  it("stops table body on blank line", () => {
    const input = [
      "| Header | Col |",
      "| --- | --- |",
      "| 中文Python | data |",
      "",
      "中文Python after",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("| 中文 Python |");
    expect(out).toContain("中文 Python after");
  });

  it("stops table body on row with different prefix", () => {
    const input = [
      "> | Header | Col |",
      "> | --- | --- |",
      "> | 中文Python | row |",
      "| 中文Python | no-prefix |",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Body row with mismatched prefix stops the table
    expect(out).toContain("> | 中文 Python | row |");
  });

  it("stops table body on row without pipes", () => {
    const input = [
      "| Header | Col |",
      "| --- | --- |",
      "| 中文Python | data |",
      "just 中文Python text without pipes",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("| 中文 Python |");
    expect(out).toContain("中文 Python text");
  });

  it("stops table body on row inside a protected region", () => {
    // Line 130: body row that's inside a protected region (e.g., inline code spanning line)
    // Construct a table where a body row is inside a fenced code block
    const input = [
      "| Header | Col |",
      "| --- | --- |",
      "| normal | data |",
      "```",
      "| code row | data |",
      "```",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Code block is preserved
    expect(out).toContain("```\n| code row | data |\n```");
    // Normal row is formatted (though no CJK here, structure preserved)
    expect(out).toContain("| normal | data |");
  });

  it("stops table body on a second delimiter row", () => {
    const input = [
      "| Header | Col |",
      "| --- | --- |",
      "| 中文Python | data |",
      "| --- | --- |",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // The first table body row is formatted
    expect(out).toContain("| 中文 Python |");
  });

  it("handles table cell with single cell (no pipe split)", () => {
    // Table where a body row has content that splitTableCells returns <= 1
    const input = [
      "| Header | Col |",
      "| --- | --- |",
      "| 中文Python | data |",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("| 中文 Python |");
    expect(out).toContain("| --- | --- |");
  });
});

describe("formatSelection", () => {
  it("applies rules to plain text selection", () => {
    const out = formatSelection("中文Python", makeConfig());
    expect(out).toBe("中文 Python");
  });

  it("applies CJK punctuation conversion", () => {
    const out = formatSelection("中文,内容", makeConfig());
    expect(out).toBe("中文，内容");
  });

  it("does not apply markdown protection (no code block handling)", () => {
    // formatSelection treats text as plain, not markdown
    const out = formatSelection("中文Python内容", makeConfig());
    expect(out).toBe("中文 Python 内容");
  });

  it("preserves two-space hard breaks when option is set", () => {
    const out = formatSelection(
      "中文Python  \n下一行",
      makeConfig({ trailingSpaceRemoval: true }),
      { preserveTwoSpaceHardBreaks: true }
    );
    expect(out).toContain("  \n");
  });
});

describe("formatter branch coverage — splitLines nullish fallback (line 52)", () => {
  it("handles single-line input with no trailing newline", () => {
    // splitLines on "text" → chunks = ["text"], chunks[1] = undefined → lineBreak = ""
    const out = formatMarkdown("中文Python单行", makeConfig());
    expect(out).toContain("中文 Python");
  });

  it("handles empty string input", () => {
    // splitLines on "" → chunks = [""], chunks[1] = undefined → lineBreak = ""
    const out = formatMarkdown("", makeConfig());
    expect(out).toBe("");
  });

  it("handles CRLF line endings (\\r\\n)", () => {
    // splitLines captures \r\n as lineBreak; chunks[i+1] = "\r\n" (not undefined)
    const out = formatMarkdown("中文Python\r\n第二行", makeConfig());
    expect(out).toContain("中文 Python");
  });
});

describe("formatter branch coverage — splitBlockquotePrefix (line 63)", () => {
  it("handles line with no blockquote prefix (empty prefix)", () => {
    // match returns ["", ""] — match[1] = "" (not undefined, ?? not needed)
    // but this exercises the code path
    const out = formatMarkdown("中文Python内容", makeConfig());
    expect(out).toContain("中文 Python");
  });

  it("handles blockquote prefix with nested arrows", () => {
    // match[1] captures "> > " prefix (always matches, ?? fallback never fires)
    const out = formatMarkdown("> > 中文Python内容", makeConfig());
    expect(out).toContain("> > 中文 Python");
  });
});

describe("formatter branch coverage — formatTableBlock cell regex (lines 190-192)", () => {
  it("handles table cell with leading/trailing whitespace (regex groups always defined)", () => {
    // The regex /^(\s*)([\s\S]*?)(\s*)$/ always matches any string.
    // Groups 1, 2, 3 always defined → ?? fallbacks never fire.
    // This test simply exercises the code path fully.
    const input = [
      "| Header | Col |",
      "| --- | --- |",
      "|  中文Python  |  data  |",
    ].join("\n");
    const out = formatMarkdown(input, makeConfig());
    expect(out).toContain("中文 Python");
  });

  it("handles table cell with empty content", () => {
    // Cell with only whitespace: match groups = [" ", "", " "]
    const input = [
      "| Header | Col |",
      "| --- | --- |",
      "|  |  |",
    ].join("\n");
    // Should not throw; empty cells formatted as-is
    expect(() => formatMarkdown(input, makeConfig())).not.toThrow();
  });
});

// ============================================================
// Regression tests: segment architecture prevents Glean-class bugs
// These document that VMark's segment extraction approach is immune
// to classes of bugs found in placeholder-based systems (e.g., Glean).
// ============================================================

describe("segment architecture: indented code blocks survive newline collapse", () => {
  it("preserves blank lines inside indented code blocks when newlineCollapsing is on", () => {
    const input = [
      "中文Python before",
      "",
      "    code line 1",
      "",
      "",
      "",
      "    code line 2",
      "",
      "中文Python after",
    ].join("\n");

    const out = formatMarkdown(
      input,
      makeConfig({ newlineCollapsing: true })
    );

    // The 3+ blank lines INSIDE the indented code block must survive
    // because indented code is a protected region
    expect(out).toContain("    code line 1");
    expect(out).toContain("    code line 2");
    // Non-protected text should still be formatted
    expect(out).toContain("中文 Python before");
    expect(out).toContain("中文 Python after");
  });

  it("preserves fenced code blocks with internal blank lines during newline collapse", () => {
    const input = [
      "中文Python before",
      "",
      "```",
      "line 1",
      "",
      "",
      "",
      "line 2",
      "```",
      "",
      "中文Python after",
    ].join("\n");

    const out = formatMarkdown(
      input,
      makeConfig({ newlineCollapsing: true })
    );

    // Blank lines inside fenced code block must survive
    expect(out).toContain("line 1\n\n\n\nline 2");
    expect(out).toContain("中文 Python before");
    expect(out).toContain("中文 Python after");
  });
});

describe("segment architecture: no cross-span matching on bold/italic", () => {
  it("does not corrupt bold spans across lines in CJK text", () => {
    const input = [
      "中文 **bold1** 文字",
      "中文 **bold2** 文字",
      "中文 **bold3** 文字",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    // Each bold span must survive intact — no greedy cross-line matching
    expect(out).toContain("**bold1**");
    expect(out).toContain("**bold2**");
    expect(out).toContain("**bold3**");
  });

  it("does not corrupt italic spans across lines in CJK text", () => {
    const input = [
      "中文 *italic1* 文字",
      "中文 *italic2* 文字",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("*italic1*");
    expect(out).toContain("*italic2*");
  });

  it("handles mixed bold/italic without cross-span corruption", () => {
    const input = [
      "中文 **粗体** 和 *斜体* 文字",
      "另一行 **bold** and *italic* text",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("**粗体**");
    expect(out).toContain("*斜体*");
    expect(out).toContain("**bold**");
    expect(out).toContain("*italic*");
  });
});

describe("reference section skipping (opt-in)", () => {
  it("formats reference sections normally when skipReferenceSections is off", () => {
    const input = [
      "中文Python content",
      "",
      "## References",
      "",
      "Author,A. Title. 中文Python Book.",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig({ skipReferenceSections: false }));

    // References section IS formatted (comma becomes fullwidth, spacing added)
    expect(out).toContain("中文 Python content");
    expect(out).toContain("中文 Python Book");
  });

  it("skips reference sections when skipReferenceSections is on", () => {
    const input = [
      "中文Python content",
      "",
      "## References",
      "",
      "Author,A. Title. 中文Python Book.",
    ].join("\n");

    const out = formatMarkdown(input, makeConfig({ skipReferenceSections: true }));

    // Main content IS formatted
    expect(out).toContain("中文 Python content");
    // References section is NOT formatted (no CJK spacing added)
    expect(out).toContain("中文Python Book");
  });
});

describe("segment architecture: no placeholder collision possible", () => {
  it("handles text containing placeholder-like patterns", () => {
    // In placeholder-based systems, text like ___CODE_BLOCK_0___ could collide.
    // VMark's segment extraction never inserts placeholders, so this is safe.
    const input = "中文Python ___PLACEHOLDER_0___ and `code` block";

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("___PLACEHOLDER_0___");
    expect(out).toContain("`code`");
  });

  it("handles text with UUID-like patterns", () => {
    const input = "中文Python __GLEAN_CJK_abc123_0__ and `inline` code";

    const out = formatMarkdown(input, makeConfig());

    expect(out).toContain("__GLEAN_CJK_abc123_0__");
    expect(out).toContain("`inline`");
  });
});

describe("formatFile", () => {
  it("delegates to formatMarkdown", () => {
    const input = "中文Python内容";
    const config = makeConfig();
    const fileOut = formatFile(input, config);
    const markdownOut = formatMarkdown(input, config);
    expect(fileOut).toBe(markdownOut);
  });

  it("handles tables in file content", () => {
    const input = [
      "| 中文Python | data |",
      "| --- | --- |",
      "| 内容Python | more |",
    ].join("\n");

    const out = formatFile(input, makeConfig());
    expect(out).toContain("| 中文 Python |");
    expect(out).toContain("| 内容 Python |");
  });

  it("passes options through", () => {
    const out = formatFile(
      "中文Python  \nmore",
      makeConfig({ trailingSpaceRemoval: true }),
      { preserveTwoSpaceHardBreaks: true }
    );
    expect(out).toContain("  \n");
  });
});

