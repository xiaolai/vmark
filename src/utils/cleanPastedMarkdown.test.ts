import { describe, it, expect } from "vitest";
import { cleanPastedMarkdown } from "./cleanPastedMarkdown";
import { createMarkdownProcessor } from "./markdownPipeline/parser";

describe("cleanPastedMarkdown — escape stripping", () => {
  it("strips escaped pipes mid-line", () => {
    expect(cleanPastedMarkdown("a \\| b")).toBe("a | b");
  });

  it("strips escaped hash mid-line", () => {
    expect(cleanPastedMarkdown("use the \\# character")).toBe("use the # character");
  });

  it("strips escaped asterisk mid-line", () => {
    expect(cleanPastedMarkdown("5 \\* 3 = 15")).toBe("5 * 3 = 15");
  });

  it("strips escaped dash mid-line", () => {
    expect(cleanPastedMarkdown("left \\- right")).toBe("left - right");
  });

  it("strips escaped dot mid-line", () => {
    expect(cleanPastedMarkdown("version 1\\.0")).toBe("version 1.0");
  });

  it("strips escaped brackets mid-line", () => {
    expect(cleanPastedMarkdown("see \\[note\\]")).toBe("see [note]");
  });

  it("strips escaped parens mid-line", () => {
    expect(cleanPastedMarkdown("item \\(a\\)")).toBe("item (a)");
  });

  it("strips escaped exclamation mid-line", () => {
    expect(cleanPastedMarkdown("wow\\!")).toBe("wow!");
  });

  it("strips escaped backtick mid-line", () => {
    expect(cleanPastedMarkdown("use \\` for code")).toBe("use ` for code");
  });

  it("strips escaped underscore mid-line", () => {
    expect(cleanPastedMarkdown("snake\\_case")).toBe("snake_case");
  });

  it("strips escaped greater-than mid-line", () => {
    expect(cleanPastedMarkdown("a \\> b")).toBe("a > b");
  });

  it("strips escaped plus mid-line", () => {
    expect(cleanPastedMarkdown("a \\+ b")).toBe("a + b");
  });

  it("keeps # at start of line (heading)", () => {
    expect(cleanPastedMarkdown("\\# Heading")).toBe("\\# Heading");
  });

  it("keeps - at start of line (list item)", () => {
    expect(cleanPastedMarkdown("\\- item")).toBe("\\- item");
  });

  it("keeps * at start of line (list item)", () => {
    expect(cleanPastedMarkdown("\\* item")).toBe("\\* item");
  });

  it("keeps > at start of line (blockquote)", () => {
    expect(cleanPastedMarkdown("\\> quote")).toBe("\\> quote");
  });

  it("keeps + at start of line (list item)", () => {
    expect(cleanPastedMarkdown("\\+ item")).toBe("\\+ item");
  });

  it("handles mixed start-of-line and mid-line escapes", () => {
    expect(cleanPastedMarkdown("\\# heading with \\# in text")).toBe(
      "\\# heading with # in text"
    );
  });

  it("handles indented lines (not start-of-line)", () => {
    // Indented content is mid-line context — strip the escape
    expect(cleanPastedMarkdown("  text \\# here")).toBe("  text # here");
  });

  it("handles multiple escapes on one line", () => {
    expect(cleanPastedMarkdown("a \\| b \\| c")).toBe("a | b | c");
  });

  it("preserves GFM table pipe separators", () => {
    const table = "| A | B |\n|---|---|\n| 1 | 2 |";
    expect(cleanPastedMarkdown(table)).toBe(table);
  });

  it("preserves \\| inside GFM table cells (unescaping would change the column count)", () => {
    // "A \| B" is ONE cell holding a literal pipe. Stripping the escape
    // would turn the 2-column header into 3 columns and break the table.
    const input = "| A \\| B | C |\n|---|---|\n| 1 | 2 |";
    expect(cleanPastedMarkdown(input)).toBe(input);
  });

  it("still strips \\| on lines without any unescaped pipe", () => {
    // No live pipe on the line → not a table row → the escape is noise.
    expect(cleanPastedMarkdown("a \\| b and c \\| d")).toBe("a | b and c | d");
  });

  it("strips \\| when the line's only other pipe is inside inline code", () => {
    // The pipe inside `|` is code (masked) — the line is not a table row.
    expect(cleanPastedMarkdown("a `|` b \\| c")).toBe("a `|` b | c");
  });

  it("round-trips a table with an escaped pipe: cell keeps its literal pipe", () => {
    const input = "| A \\| B | C |\n| --- | --- |\n| 1 | 2 |";
    const cleaned = cleanPastedMarkdown(input);
    expect(cleaned).toBe(input);
    const tree = createMarkdownProcessor().parse(cleaned);
    const json = JSON.stringify(tree);
    expect(json).toContain('"type":"table"');
    // The first cell still parses to the literal text "A | B".
    expect(json).toContain("A | B");
  });

  it("returns empty string unchanged", () => {
    expect(cleanPastedMarkdown("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(cleanPastedMarkdown("hello world")).toBe("hello world");
  });

  it("preserves backslash-newline (hard break)", () => {
    expect(cleanPastedMarkdown("line1\\\nline2")).toBe("line1\\\nline2");
  });
});

describe("cleanPastedMarkdown — <br> tags in tables (kept: valid GFM)", () => {
  // GFM table cells cannot contain literal newlines — <br> is the only
  // valid way to represent a line break inside a cell. Converting it to
  // "\n" would structurally break the table, so <br> is left untouched.
  it("leaves <br> untouched in table rows", () => {
    const input = "| A | Line 1<br>Line 2 |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(input);
  });

  it("leaves <br/> untouched in table rows", () => {
    const input = "| A | Line 1<br/>Line 2 |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(input);
  });

  it("leaves <br /> untouched in table rows", () => {
    const input = "| A | Line 1<br />Line 2 |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(input);
  });

  it("leaves <br> untouched outside table rows", () => {
    const input = "Hello<br>World";
    expect(cleanPastedMarkdown(input)).toBe("Hello<br>World");
  });

  it("leaves multiple <br> in one table row untouched", () => {
    const input = "| A | L1<br>L2<br>L3 |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(input);
  });

  it("leaves <br> inside inline code in table row untouched", () => {
    const input = "| A | `x<br>y` |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(input);
  });

  it("round-trips a table with <br> cells unchanged and it still parses as a table", () => {
    const input = "| A | B |\n|---|---|\n| L1<br>L2 | x |";
    const cleaned = cleanPastedMarkdown(input);
    expect(cleaned).toBe(input);
    // Every row must remain a single `|`-delimited line — no injected
    // newlines that would split a row and break the table structure.
    const rows = cleaned.split("\n");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatch(/^\|.*\|$/);
    }
    // And remark-gfm must still recognize it as a table.
    const tree = createMarkdownProcessor().parse(cleaned);
    expect(JSON.stringify(tree)).toContain('"type":"table"');
  });
});

describe("cleanPastedMarkdown — code-aware escape stripping", () => {
  it("preserves \\* inside fenced code block", () => {
    const input = "text\n```\n\\* not a list\n```\nmore";
    expect(cleanPastedMarkdown(input)).toBe("text\n```\n\\* not a list\n```\nmore");
  });

  it("preserves \\# inside fenced code block", () => {
    const input = "```\n\\# not a heading\n```";
    expect(cleanPastedMarkdown(input)).toBe("```\n\\# not a heading\n```");
  });

  it("preserves \\| inside fenced code block", () => {
    const input = "```\na \\| b\n```";
    expect(cleanPastedMarkdown(input)).toBe("```\na \\| b\n```");
  });

  it("preserves escapes inside inline code", () => {
    const input = "use `\\*bold\\*` for emphasis";
    expect(cleanPastedMarkdown(input)).toBe("use `\\*bold\\*` for emphasis");
  });

  it("strips escapes outside code but preserves inside on same line", () => {
    const input = "text \\* bold `\\* code` end";
    expect(cleanPastedMarkdown(input)).toBe("text * bold `\\* code` end");
  });

  it("preserves escapes inside tilde-fenced code block", () => {
    const input = "~~~\n\\# heading\n~~~";
    expect(cleanPastedMarkdown(input)).toBe("~~~\n\\# heading\n~~~");
  });

  it("preserves escapes inside multi-backtick inline code", () => {
    const input = "text ``\\| pipe`` end";
    expect(cleanPastedMarkdown(input)).toBe("text ``\\| pipe`` end");
  });
});

describe("cleanPastedMarkdown — ordered list trigger preservation", () => {
  it("preserves 1\\. at start of line", () => {
    expect(cleanPastedMarkdown("1\\. First item")).toBe("1\\. First item");
  });

  it("strips 1\\. mid-line", () => {
    expect(cleanPastedMarkdown("version 1\\. something")).toBe(
      "version 1. something"
    );
  });

  it("preserves multi-digit ordered list trigger", () => {
    expect(cleanPastedMarkdown("10\\. Tenth item")).toBe("10\\. Tenth item");
  });

  it("preserves 1\\) at start of line (parenthesized marker)", () => {
    expect(cleanPastedMarkdown("1\\) First item")).toBe("1\\) First item");
  });

  it("strips 1\\) mid-line", () => {
    expect(cleanPastedMarkdown("item 1\\) done")).toBe("item 1) done");
  });
});
