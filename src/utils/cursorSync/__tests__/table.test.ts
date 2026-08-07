// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getTableAnchorForLine } from "../table";

describe("getTableAnchorForLine", () => {
  it("returns header row/col and offset for table header", () => {
    const lines = ["| Col1 | Col2 |", "| --- | --- |", "| a | bb |"];
    const lineIndex = 0;
    const column = lines[0].indexOf("Col2") + 1;
    const anchor = getTableAnchorForLine(lines, lineIndex, column);

    expect(anchor).toEqual({
      kind: "table",
      row: 0,
      col: 1,
      offsetInCell: 1,
    });
  });

  it("returns body row/col and offset for table body", () => {
    const lines = ["| Col1 | Col2 |", "| --- | --- |", "| a | bb |"];
    const lineIndex = 2;
    const column = lines[2].indexOf("bb") + 1;
    const anchor = getTableAnchorForLine(lines, lineIndex, column);

    expect(anchor).toEqual({
      kind: "table",
      row: 1,
      col: 1,
      offsetInCell: 1,
    });
  });

  it("returns undefined for separator lines", () => {
    const lines = ["| Col1 | Col2 |", "| --- | --- |", "| a | bb |"];
    const anchor = getTableAnchorForLine(lines, 1, 2);
    expect(anchor).toBeUndefined();
  });

  it("returns undefined when no table structure is detected", () => {
    const lines = ["| not a table | maybe |", "plain text"];
    const anchor = getTableAnchorForLine(lines, 0, 3);
    expect(anchor).toBeUndefined();
  });

  it("returns correct row for 2nd+ data rows in multi-row tables", () => {
    const lines = [
      "| Name | Age |",
      "| --- | --- |",
      "| Alice | 30 |",
      "| Bob | 25 |",
      "| Carol | 40 |",
    ];

    // 2nd data row (lineIndex=3, "Bob") → row should be 2
    const anchor3 = getTableAnchorForLine(lines, 3, lines[3].indexOf("Bob"));
    expect(anchor3).toBeDefined();
    expect(anchor3!.row).toBe(2);
    expect(anchor3!.col).toBe(0);

    // 3rd data row (lineIndex=4, "Carol") → row should be 3
    const anchor4 = getTableAnchorForLine(lines, 4, lines[4].indexOf("Carol"));
    expect(anchor4).toBeDefined();
    expect(anchor4!.row).toBe(3);
    expect(anchor4!.col).toBe(0);
  });

  it("returns undefined when cellRanges is empty (line 127: all pipes are escaped)", () => {
    // A line that passes isTableRowLine (contains \|) but when parsed by
    // getTableCellRanges all pipes are escaped — so separators.length === 0 → [].
    // findTableHeaderLineIndex must return non-null for the line to reach line 127.
    // We use a real table header above, and the data row has only escaped pipes.
    // Actually findTableHeaderLineIndex uses isTableRowLine which checks /\|/,
    // and escaped pipes show up as \| in the string which still matches /\|/.
    // The separator line must be a real separator. The data line can have escaped pipes.
    const lines = [
      "| h1 | h2 |",     // index 0 — header with real pipes
      "| --- | --- |",   // index 1 — separator
      "\\|escaped\\|",   // index 2 — all pipes escaped → cellRanges empty
    ];
    // lineIndex=2: findTableHeaderLineIndex checks lineIndex-1=separator → finds header at 0
    // isTableSeparatorLine(lines[2]) = false (passes the guard)
    // getTableCellRanges("\\|escaped\\|") → all \ before | → no separators → returns []
    const anchor = getTableAnchorForLine(lines, 2, 1);
    expect(anchor).toBeUndefined();
  });
});
