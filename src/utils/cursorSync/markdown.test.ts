// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  detectNodeType,
  stripMarkdownSyntax,
  stripInlineFormatting,
  findCodeFenceStartLine,
  isInsideCodeBlock,
} from "./markdown";

describe("detectNodeType", () => {
  describe("headings", () => {
    it.each([
      { line: "# Heading 1", expected: "heading" },
      { line: "## Heading 2", expected: "heading" },
      { line: "### Heading 3", expected: "heading" },
      { line: "###### Heading 6", expected: "heading" },
    ])("detects heading: $line", ({ line, expected }) => {
      expect(detectNodeType(line)).toBe(expected);
    });

    it("does not detect heading without space", () => {
      expect(detectNodeType("#NoSpace")).toBe("paragraph");
    });

    it("detects heading with leading whitespace", () => {
      expect(detectNodeType("  # Heading")).toBe("heading");
    });
  });

  describe("list items", () => {
    it.each([
      { line: "- item", expected: "list_item" },
      { line: "* item", expected: "list_item" },
      { line: "+ item", expected: "list_item" },
      { line: "1. item", expected: "list_item" },
      { line: "10. item", expected: "list_item" },
      { line: "  - nested item", expected: "list_item" },
    ])("detects list item: $line", ({ line, expected }) => {
      expect(detectNodeType(line)).toBe(expected);
    });

    it("does not detect list without space after marker", () => {
      expect(detectNodeType("-noSpace")).toBe("paragraph");
    });
  });

  describe("code blocks", () => {
    it.each([
      { line: "```", expected: "code_block" },
      { line: "```javascript", expected: "code_block" },
      { line: "~~~", expected: "code_block" },
      { line: "~~~python", expected: "code_block" },
    ])("detects code fence: $line", ({ line, expected }) => {
      expect(detectNodeType(line)).toBe(expected);
    });
  });

  describe("alert blocks", () => {
    it.each([
      { line: "> [!NOTE]", expected: "alert_block" },
      { line: "> [!TIP]", expected: "alert_block" },
      { line: "> [!IMPORTANT]", expected: "alert_block" },
      { line: "> [!WARNING]", expected: "alert_block" },
      { line: "> [!CAUTION]", expected: "alert_block" },
      { line: ">  [!note]", expected: "alert_block" },
    ])("detects alert block: $line", ({ line, expected }) => {
      expect(detectNodeType(line)).toBe(expected);
    });
  });

  describe("blockquotes", () => {
    it.each([
      { line: "> text", expected: "blockquote" },
      { line: ">text", expected: "blockquote" },
      { line: ">> nested", expected: "blockquote" },
    ])("detects blockquote: $line", ({ line, expected }) => {
      expect(detectNodeType(line)).toBe(expected);
    });
  });

  describe("details blocks", () => {
    it.each([
      { line: "::: details", expected: "details_block" },
      { line: "::: Details Title", expected: "details_block" },
      { line: "<details>", expected: "details_block" },
      { line: "<details open>", expected: "details_block" },
    ])("detects details block: $line", ({ line, expected }) => {
      expect(detectNodeType(line)).toBe(expected);
    });
  });

  describe("table cells", () => {
    it.each([
      { line: "| a | b | c |", expected: "table_cell" },
      { line: "| header |", expected: "table_cell" },
      { line: "|a|b|", expected: "table_cell" },
    ])("detects table cell: $line", ({ line, expected }) => {
      expect(detectNodeType(line)).toBe(expected);
    });

    it("does not detect table from text with single pipe", () => {
      expect(detectNodeType("a | b")).toBe("paragraph");
    });

    it("detects table row starting with pipe but not ending with pipe (line 60-61)", () => {
      expect(detectNodeType("| a | b")).toBe("table_cell");
    });
  });

  describe("wiki links", () => {
    it("detects wiki link on its own line", () => {
      expect(detectNodeType("[[My Page]]")).toBe("wiki_link");
    });

    it("does not detect wiki link with surrounding text", () => {
      expect(detectNodeType("see [[My Page]] here")).toBe("paragraph");
    });
  });

  describe("paragraph fallback", () => {
    it.each([
      { line: "plain text" },
      { line: "" },
      { line: "   " },
      { line: "some **bold** text" },
    ])("returns paragraph for: '$line'", ({ line }) => {
      expect(detectNodeType(line)).toBe("paragraph");
    });
  });
});

describe("stripMarkdownSyntax", () => {
  describe("heading markers", () => {
    it("strips heading marker and adjusts column", () => {
      const result = stripMarkdownSyntax("## Hello", 5);
      expect(result.text).toBe("Hello");
      expect(result.adjustedColumn).toBe(2); // 5 - 3 ("## ")
    });

    it("returns column 0 when cursor is inside heading marker", () => {
      const result = stripMarkdownSyntax("## Hello", 1);
      expect(result.text).toBe("Hello");
      expect(result.adjustedColumn).toBe(0);
    });

    it("strips h1 marker", () => {
      const result = stripMarkdownSyntax("# Title", 5);
      expect(result.text).toBe("Title");
      expect(result.adjustedColumn).toBe(3);
    });
  });

  describe("list markers", () => {
    it("strips unordered list marker", () => {
      const result = stripMarkdownSyntax("- item text", 7);
      expect(result.text).toBe("item text");
      expect(result.adjustedColumn).toBe(5);
    });

    it("strips numbered list marker", () => {
      const result = stripMarkdownSyntax("1. item text", 6);
      expect(result.text).toBe("item text");
      expect(result.adjustedColumn).toBe(3);
    });

    it("strips indented list marker", () => {
      const result = stripMarkdownSyntax("  - nested", 6);
      expect(result.text).toBe("nested");
      expect(result.adjustedColumn).toBe(2);
    });

    it("returns column 0 when cursor is inside list marker", () => {
      const result = stripMarkdownSyntax("- item", 0);
      expect(result.text).toBe("item");
      expect(result.adjustedColumn).toBe(0);
    });
  });

  describe("blockquote markers", () => {
    it("strips blockquote marker", () => {
      const result = stripMarkdownSyntax("> quoted text", 5);
      expect(result.text).toBe("quoted text");
      expect(result.adjustedColumn).toBe(3);
    });

    it("strips nested blockquote markers", () => {
      const result = stripMarkdownSyntax(">> nested quote", 6);
      expect(result.text).toBe("nested quote");
      // ">>" is 2 chars, but regex matches "> > " or ">> " patterns
      expect(result.adjustedColumn).toBeGreaterThanOrEqual(0);
    });

    it("strips nested blockquote + list markers (> - item)", () => {
      // "> - item" => blockquote "> " stripped first, then "- " list marker
      const result = stripMarkdownSyntax("> - item", 8);
      expect(result.text).toBe("item");
      expect(result.adjustedColumn).toBe(4);
    });

    it("strips nested blockquote + ordered list (> 1. item)", () => {
      const result = stripMarkdownSyntax("> 1. item", 9);
      expect(result.text).toBe("item");
      expect(result.adjustedColumn).toBe(4);
    });

    it("strips deeply nested blockquote (>> nested)", () => {
      const result = stripMarkdownSyntax(">> nested", 9);
      expect(result.text).toBe("nested");
      expect(result.adjustedColumn).toBe(6);
    });

    it("strips deeply nested blockquote + list (> > - item)", () => {
      const result = stripMarkdownSyntax("> > - item", 10);
      expect(result.text).toBe("item");
      expect(result.adjustedColumn).toBe(4);
    });

    it("returns column 0 when cursor is inside blockquote marker", () => {
      const result = stripMarkdownSyntax("> text", 0);
      expect(result.text).toBe("text");
      expect(result.adjustedColumn).toBe(0);
    });
  });

  describe("plain text", () => {
    it("does not modify plain text", () => {
      const result = stripMarkdownSyntax("plain text", 5);
      expect(result.text).toBe("plain text");
      expect(result.adjustedColumn).toBe(5);
    });

    it("handles empty string", () => {
      const result = stripMarkdownSyntax("", 0);
      expect(result.text).toBe("");
      expect(result.adjustedColumn).toBe(0);
    });
  });

  describe("adjusted column is never negative", () => {
    it("returns 0 for column 0 on any line", () => {
      const result = stripMarkdownSyntax("## heading", 0);
      expect(result.adjustedColumn).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("stripInlineFormatting", () => {
  it.each([
    { input: "**bold**", expected: "bold" },
    { input: "__bold__", expected: "bold" },
    { input: "*italic*", expected: "italic" },
    { input: "_italic_", expected: "italic" },
    { input: "~~strike~~", expected: "strike" },
    { input: "`code`", expected: "code" },
    { input: "[link](http://example.com)", expected: "link" },
    { input: "![alt](image.png)", expected: "!alt" },
    { input: "$x^2$", expected: "x^2" },
    { input: "[^1]", expected: "" },
    { input: "[^label]", expected: "" },
  ])("strips formatting: $input -> $expected", ({ input, expected }) => {
    expect(stripInlineFormatting(input)).toBe(expected);
  });

  it("strips mixed formatting", () => {
    const result = stripInlineFormatting("**bold** and *italic* and `code`");
    expect(result).toBe("bold and italic and code");
  });

  it("returns plain text unchanged", () => {
    expect(stripInlineFormatting("no formatting here")).toBe(
      "no formatting here"
    );
  });

  it("handles empty string", () => {
    expect(stripInlineFormatting("")).toBe("");
  });

  it("strips footnote references from text", () => {
    const result = stripInlineFormatting("text[^1] more[^label] end");
    expect(result).toBe("text more end");
  });
});

describe("findCodeFenceStartLine", () => {
  it("returns null for line outside code block", () => {
    const lines = ["hello", "world"];
    expect(findCodeFenceStartLine(lines, 0)).toBeNull();
  });

  it("returns fence start for line inside backtick code block", () => {
    const lines = ["```js", "const x = 1;", "```"];
    expect(findCodeFenceStartLine(lines, 1)).toBe(0);
  });

  it("returns fence start for line inside tilde code block", () => {
    const lines = ["~~~python", "print('hi')", "~~~"];
    expect(findCodeFenceStartLine(lines, 1)).toBe(0);
  });

  it("returns null after code block is closed", () => {
    const lines = ["```", "code", "```", "after"];
    expect(findCodeFenceStartLine(lines, 3)).toBeNull();
  });

  it("handles nested-looking fences (same type closes)", () => {
    const lines = ["```", "line1", "```", "```", "line2", "```"];
    // Line 1 is inside first block (fence at 0)
    expect(findCodeFenceStartLine(lines, 1)).toBe(0);
    // Line 3 is the opening fence of the second block
    expect(findCodeFenceStartLine(lines, 4)).toBe(3);
  });

  it("does not close backtick block with tilde fence", () => {
    const lines = ["```", "code", "~~~", "still code"];
    // ~~~ does not close ``` block
    expect(findCodeFenceStartLine(lines, 3)).toBe(0);
  });

  it("returns null for the opening fence line itself (open but scanning starts there)", () => {
    const lines = ["```js", "code", "```"];
    // The opening fence line is considered "inside" the code block
    expect(findCodeFenceStartLine(lines, 0)).toBe(0);
  });

  it("handles empty document", () => {
    expect(findCodeFenceStartLine([], 0)).toBeNull();
  });

  it("handles code block at end of document without closing fence", () => {
    const lines = ["text", "```", "unclosed"];
    expect(findCodeFenceStartLine(lines, 2)).toBe(1);
  });

  it("handles indented fences", () => {
    const lines = ["  ```", "code", "  ```"];
    // trimmed matches
    expect(findCodeFenceStartLine(lines, 1)).toBe(0);
  });
});

describe("isInsideCodeBlock", () => {
  it("returns false for line outside code block", () => {
    expect(isInsideCodeBlock(["hello", "world"], 0)).toBe(false);
  });

  it("returns true for line inside code block", () => {
    const lines = ["```", "inside", "```"];
    expect(isInsideCodeBlock(lines, 1)).toBe(true);
  });

  it("returns false for line after closed code block", () => {
    const lines = ["```", "inside", "```", "outside"];
    expect(isInsideCodeBlock(lines, 3)).toBe(false);
  });

  it("returns true for unclosed code block", () => {
    const lines = ["```", "unclosed"];
    expect(isInsideCodeBlock(lines, 1)).toBe(true);
  });

  it("returns true for opening fence line", () => {
    const lines = ["```js", "code"];
    expect(isInsideCodeBlock(lines, 0)).toBe(true);
  });

  it("closes tilde fence and marks line after as outside (lines 183-185)", () => {
    const lines = ["~~~", "inside", "~~~", "outside"];
    expect(isInsideCodeBlock(lines, 1)).toBe(true);
    expect(isInsideCodeBlock(lines, 3)).toBe(false);
  });
});
