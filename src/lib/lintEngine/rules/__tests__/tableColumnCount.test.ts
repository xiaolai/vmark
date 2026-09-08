// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { tableColumnCount } from "../tableColumnCount";
import type { Root, Table, TableRow, TableCell } from "mdast";

/** A synthetic mdast carries no source, so the line index it is linted with is empty. */
const EMPTY_INDEX = { lines: [], lineOffsets: [] };

describe("E02 tableColumnCount", () => {
  it.each([
    {
      name: "clean: table with matching column counts",
      input: "| A | B |\n|---|---|\n| 1 | 2 |",
      expected: 0,
    },
    {
      name: "flagged: body row has fewer columns than header",
      input: "| A | B | C |\n|---|---|---|\n| 1 | 2 |",
      expected: 1,
    },
    {
      name: "flagged: body row has more columns than header",
      input: "| A | B |\n|---|---|\n| 1 | 2 | 3 |",
      expected: 1,
    },
    {
      name: "clean: table with only header row (no body rows to check)",
      input: "| A | B |\n|---|---|",
      expected: 0,
    },
    {
      name: "flagged: multiple mismatched rows each produce one diagnostic",
      input: "| A | B |\n|---|---|\n| 1 |\n| 2 |",
      expected: 2,
    },
    {
      name: "clean: multiple tables both correct",
      input: "| A | B |\n|---|---|\n| 1 | 2 |\n\n| X | Y | Z |\n|---|---|---|\n| a | b | c |",
      expected: 0,
    },
    {
      name: "flagged: second table has mismatched row",
      input: "| A | B |\n|---|---|\n| 1 | 2 |\n\n| X | Y | Z |\n|---|---|---|\n| a | b |",
      expected: 1,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
  ])("$name → $expected E02 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "E02");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity, uiHint, and messageParams", () => {
    const result = lintMarkdown("| A | B | C |\n|---|---|---|\n| 1 | 2 |");
    const d = result.find((d) => d.ruleId === "E02");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.uiHint).toBe("block");
    expect(d!.messageKey).toBe("lint.E02");
    expect(d!.messageParams.expected).toBe("3");
    expect(d!.messageParams.found).toBe("2");
  });

  it("skips mismatched rows without position (continue branch)", () => {
    // Build a synthetic table where a body row has wrong column count but no position
    const cell = (text: string): TableCell => ({
      type: "tableCell",
      children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
    }) as unknown as TableCell;

    const headerRow: TableRow = {
      type: "tableRow",
      children: [cell("A"), cell("B"), cell("C")],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 15, offset: 14 },
      },
    };

    const bodyRowNoPosition: TableRow = {
      type: "tableRow",
      children: [cell("1"), cell("2")], // mismatch but no position
    } as TableRow;

    const bodyRowWithPosition: TableRow = {
      type: "tableRow",
      children: [cell("x"), cell("y")], // mismatch with position
      position: {
        start: { line: 3, column: 1, offset: 30 },
        end: { line: 3, column: 10, offset: 39 },
      },
    };

    const table: Table = {
      type: "table",
      children: [headerRow, bodyRowNoPosition, bodyRowWithPosition],
    } as Table;

    const mdast: Root = { type: "root", children: [table] };

    const diagnostics = tableColumnCount("", mdast, EMPTY_INDEX);
    // Only the row with position should produce a diagnostic
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].line).toBe(3);
  });

  it("uses offset fallback when position.start.offset is undefined", () => {
    const cell = (text: string): TableCell => ({
      type: "tableCell",
      children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
    }) as unknown as TableCell;

    const headerRow: TableRow = {
      type: "tableRow",
      children: [cell("A"), cell("B")],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 10, offset: 9 },
      },
    };

    const bodyRow: TableRow = {
      type: "tableRow",
      children: [cell("1")], // mismatch
      position: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 5 },
      },
    } as unknown as TableRow;

    const table: Table = {
      type: "table",
      children: [headerRow, bodyRow],
    } as Table;

    const mdast: Root = { type: "root", children: [table] };

    const diagnostics = tableColumnCount("", mdast, EMPTY_INDEX);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(0);
  });
});

// Audit 20260907 round 3 (#858): the same `offset ?? 0` as W01, on a row that
// is never the first thing in the document.
describe("E02 — a missing parser offset falls back to the line index, not to 0", () => {
  it("locates the row on its own line", () => {
    const row = (line: number, cells: number, withOffset: boolean) => ({
      type: "tableRow",
      children: Array.from({ length: cells }, () => ({ type: "tableCell", children: [] })),
      position: {
        start: withOffset ? { line, column: 1, offset: 0 } : { line, column: 1 },
        end: { line, column: 10 },
      },
    });
    const mdast = {
      type: "root",
      children: [
        {
          type: "table",
          children: [row(1, 2, true), row(3, 1, false)],
          position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 3, column: 10 } },
        },
      ],
    } as unknown as Root;

    const diagnostics = tableColumnCount("", mdast, { lines: ["| a | b |", "| - | - |", "| 1 |"], lineOffsets: [0, 10, 20] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(20);
  });
});
