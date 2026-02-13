import { describe, it, expect } from "vitest";
import { cleanPastedMarkdown } from "./cleanPastedMarkdown";

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

  it("cleans escaped pipes inside GFM table cells", () => {
    const input = "| A \\| B | C |\n|---|---|\n| 1 | 2 |";
    const expected = "| A | B | C |\n|---|---|\n| 1 | 2 |";
    expect(cleanPastedMarkdown(input)).toBe(expected);
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

describe("cleanPastedMarkdown — <br> tag cleanup", () => {
  it("converts <br> to newline in table rows", () => {
    const input = "| A | Line 1<br>Line 2 |\n|---|---|";
    const expected = "| A | Line 1\nLine 2 |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(expected);
  });

  it("converts <br/> to newline in table rows", () => {
    const input = "| A | Line 1<br/>Line 2 |\n|---|---|";
    const expected = "| A | Line 1\nLine 2 |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(expected);
  });

  it("converts <br /> to newline in table rows", () => {
    const input = "| A | Line 1<br />Line 2 |\n|---|---|";
    const expected = "| A | Line 1\nLine 2 |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(expected);
  });

  it("does not convert <br> outside table rows", () => {
    const input = "Hello<br>World";
    expect(cleanPastedMarkdown(input)).toBe("Hello<br>World");
  });

  it("handles multiple <br> in one table row", () => {
    const input = "| A | L1<br>L2<br>L3 |\n|---|---|";
    const expected = "| A | L1\nL2\nL3 |\n|---|---|";
    expect(cleanPastedMarkdown(input)).toBe(expected);
  });
});
