// @vitest-environment node
/**
 * Table Detection Tests
 *
 * Tests for isTableLine, getSourceTableInfo, and related utilities.
 * Covers escaped pipes, code spans, non-table pipe lines, and table boundaries.
 */

import { describe, expect, it } from "vitest";
import { splitTableCells, parseTableRow } from "@/utils/tableParser";

// We test the pure functions exported from tableDetection.
// getSourceTableInfo requires an EditorView, tested via integration or
// by extracting the internal helpers.

// Import the internal helpers we'll expose for testing
import { isTableLine } from "../tableDetection";

describe("isTableLine", () => {
  it("returns true for standard table row", () => {
    expect(isTableLine("| A | B |")).toBe(true);
  });

  it("returns true for separator line", () => {
    expect(isTableLine("| --- | --- |")).toBe(true);
  });

  it("returns true for row with escaped pipe", () => {
    expect(isTableLine("| A \\| B | C |")).toBe(true);
  });

  it("returns false for shell command with pipe", () => {
    expect(isTableLine("echo foo | grep bar")).toBe(false);
  });

  it("returns false for pipe in middle of sentence", () => {
    expect(isTableLine("Use A | B notation for alternatives")).toBe(false);
  });

  it("returns true for table row with leading whitespace", () => {
    expect(isTableLine("  | A | B |")).toBe(true);
  });

  it("returns false for empty line", () => {
    expect(isTableLine("")).toBe(false);
  });

  it("returns false for line with only pipe", () => {
    expect(isTableLine("|")).toBe(false);
  });

  it("returns true for minimal table row", () => {
    expect(isTableLine("| A |")).toBe(true);
  });

  it("returns false for single-cell line without trailing pipe", () => {
    expect(isTableLine("| A")).toBe(false);
  });

  it("returns true for two-column row", () => {
    expect(isTableLine("| A | B")).toBe(true);
  });
});

describe("splitTableCells with escaped pipes", () => {
  it("splits simple cells", () => {
    const cells = splitTableCells(" A | B ");
    expect(cells).toEqual([" A ", " B "]);
  });

  it("handles escaped pipe inside cell", () => {
    // "A \\| B | C" should produce 2 cells, not 3
    const cells = splitTableCells("A \\| B | C");
    expect(cells).toEqual(["A \\| B ", " C"]);
  });

  it("handles code span with pipe", () => {
    const cells = splitTableCells("`a|b` | c");
    expect(cells).toEqual(["`a|b` ", " c"]);
  });
});

describe("parseTableRow with escaped pipes", () => {
  it("parses simple row", () => {
    expect(parseTableRow("| A | B |")).toEqual(["A", "B"]);
  });

  it("parses row with escaped pipe", () => {
    expect(parseTableRow("| A \\| B | C |")).toEqual(["A \\| B", "C"]);
  });

  it("parses row with code span containing pipe", () => {
    expect(parseTableRow("| `a|b` | c |")).toEqual(["`a|b`", "c"]);
  });

  it("parses separator correctly", () => {
    expect(parseTableRow("| --- | :---: |")).toEqual(["---", ":---:"]);
  });
});

// ---------------------------------------------------------------------------
// getSourceTableInfo — requires a mock EditorView
// ---------------------------------------------------------------------------

import { getSourceTableInfo, isInEditableTableRow } from "../tableDetection";
import type { EditorView } from "@codemirror/view";
import { Text } from "@codemirror/state";

function createMockView(content: string, cursorPos: number): EditorView {
  const doc = Text.of(content.split("\n"));
  return {
    state: {
      doc,
      selection: { main: { from: cursorPos } },
    },
  } as unknown as EditorView;
}

describe("getSourceTableInfo", () => {
  const table = [
    "| H1 | H2 |",
    "| --- | --- |",
    "| A  | B  |",
    "| C  | D  |",
  ].join("\n");

  it("returns table info when cursor is on a data row", () => {
    // Cursor on line 3 ("| A  | B  |"), at position after the lines above
    const lines = table.split("\n");
    // line1 len=12, line2 len=13, line3 starts at 12+1+13+1 = 27
    const line3Start = lines[0].length + 1 + lines[1].length + 1;
    const view = createMockView(table, line3Start + 3);
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.lines).toHaveLength(4);
    expect(info!.rowIndex).toBe(2);
    expect(info!.colCount).toBe(2);
    expect(info!.startLine).toBe(0); // 0-indexed
    expect(info!.endLine).toBe(3);
  });

  it("returns table info when cursor is on header row", () => {
    const view = createMockView(table, 3); // inside "| H1 | H2 |"
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.rowIndex).toBe(0);
  });

  it("returns table info when cursor is on separator row", () => {
    const lines = table.split("\n");
    const line2Start = lines[0].length + 1;
    const view = createMockView(table, line2Start + 2);
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.rowIndex).toBe(1);
  });

  it("returns null when cursor is not in a table", () => {
    const content = "Just a paragraph\nNo table here";
    const view = createMockView(content, 5);
    expect(getSourceTableInfo(view)).toBeNull();
  });

  it("returns null for a single table line (needs at least 2)", () => {
    const content = "| A | B |";
    const view = createMockView(content, 3);
    expect(getSourceTableInfo(view)).toBeNull();
  });

  it("returns null when second line is not a separator", () => {
    const content = "| A | B |\n| C | D |";
    const view = createMockView(content, 3);
    expect(getSourceTableInfo(view)).toBeNull();
  });

  it("returns null when second line does not start with pipe (isSeparatorLine early return)", () => {
    // Second line is a plain text line, not starting with '|'
    const content = "| A | B |\nsome text line";
    const view = createMockView(content, 3);
    expect(getSourceTableInfo(view)).toBeNull();
  });

  it("handles table surrounded by non-table lines", () => {
    const content = [
      "Paragraph before",
      "| H1 | H2 |",
      "| --- | --- |",
      "| A  | B  |",
      "Paragraph after",
    ].join("\n");
    const lines = content.split("\n");
    // line 2 starts at len("Paragraph before\n") = 17
    const line2Start = lines[0].length + 1;
    const view = createMockView(content, line2Start + 3);
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.lines).toHaveLength(3);
    expect(info!.startLine).toBe(1); // 0-indexed from doc line 2
    expect(info!.endLine).toBe(3);
  });

  it("detects correct colIndex based on cursor position", () => {
    // "| H1 | H2 |" — cursor at position 7 is inside H2 cell
    const view = createMockView(table, 7);
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.colIndex).toBe(1);
  });

  it("clamps colIndex to colCount - 1", () => {
    // cursor at end of a row with more pipes than separator columns
    const content = "| A | B | C |\n| --- | --- |\n| D | E | F |";
    const view = createMockView(content, 10); // near "C" in first row
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    // colCount from separator is 2, so colIndex should be clamped to 1
    expect(info!.colIndex).toBeLessThanOrEqual(info!.colCount - 1);
  });
});

describe("getSourceTableInfo — edge cases", () => {
  it("handles table at the very end of document (no trailing non-table line)", () => {
    const content = "| A | B |\n| --- | --- |\n| C | D |";
    const lines = content.split("\n");
    // Cursor on last line
    const lastLineStart = lines[0].length + 1 + lines[1].length + 1;
    const view = createMockView(content, lastLineStart + 2);
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.lines).toHaveLength(3);
    expect(info!.endLine).toBe(2);
  });

  it("handles table at the very start of document", () => {
    const content = "| A | B |\n| --- | --- |\n| C | D |\nParagraph after";
    const view = createMockView(content, 3);
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.startLine).toBe(0);
    expect(info!.lines).toHaveLength(3);
  });

  it("detects correct colIndex with escaped pipe in cell", () => {
    const line = "| A \\| B | C |";
    const content = `${line}\n| --- | --- |\n| D | E |`;
    const view = createMockView(content, 12); // near "C" in first row
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    // After escaped pipe, "C" is in col 1
    expect(info!.colIndex).toBe(1);
  });

  it("detects correct colIndex with backtick code span containing pipe", () => {
    const line = "| `a|b` | c |";
    const content = `${line}\n| --- | --- |\n| d | e |`;
    const view = createMockView(content, 10); // near "c" in first row
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.colIndex).toBe(1);
  });

  it("detects correct colIndex with multi-backtick code span", () => {
    const line = "| ``a|b`` | c |";
    const content = `${line}\n| --- | --- |\n| d | e |`;
    const view = createMockView(content, 12); // near "c"
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.colIndex).toBe(1);
  });

  it("returns colIndex 0 when cursor is before first cell boundary", () => {
    const content = "| Hello | World |\n| --- | --- |\n| A | B |";
    const view = createMockView(content, 3); // inside "Hello"
    const info = getSourceTableInfo(view);

    expect(info).not.toBeNull();
    expect(info!.colIndex).toBe(0);
  });
});

describe("isInEditableTableRow", () => {
  it("returns true for header row (rowIndex 0)", () => {
    expect(isInEditableTableRow({ rowIndex: 0 } as any)).toBe(true);
  });

  it("returns false for separator row (rowIndex 1)", () => {
    expect(isInEditableTableRow({ rowIndex: 1 } as any)).toBe(false);
  });

  it("returns true for data row (rowIndex 2)", () => {
    expect(isInEditableTableRow({ rowIndex: 2 } as any)).toBe(true);
  });

  it("returns true for later data rows", () => {
    expect(isInEditableTableRow({ rowIndex: 5 } as any)).toBe(true);
  });
});
