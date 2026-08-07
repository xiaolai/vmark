// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getTableAnchorForLine, restoreTableColumnFromAnchor } from "./table";

describe("getTableAnchorForLine", () => {
  describe("basic table detection", () => {
    it("returns anchor for header row (row 0)", () => {
      const lines = ["| a | b |", "|---|---|", "| 1 | 2 |"];
      const anchor = getTableAnchorForLine(lines, 0, 2);
      expect(anchor).toBeDefined();
      expect(anchor!.kind).toBe("table");
      expect(anchor!.row).toBe(0);
    });

    it("returns anchor for data row (row 1+)", () => {
      const lines = ["| a | b |", "|---|---|", "| 1 | 2 |"];
      const anchor = getTableAnchorForLine(lines, 2, 2);
      expect(anchor).toBeDefined();
      expect(anchor!.kind).toBe("table");
      // lineIndex=2, headerLine=0, row = 2 - (0+1) = 1 (first data row after separator)
      // But separator is at index 1, so data row 2 maps to row = 2 - (0+1) = 1
      expect(anchor!.row).toBe(1);
    });

    it("returns undefined for separator line", () => {
      const lines = ["| a | b |", "|---|---|", "| 1 | 2 |"];
      const anchor = getTableAnchorForLine(lines, 1, 2);
      expect(anchor).toBeUndefined();
    });

    it("returns undefined for non-table content", () => {
      const lines = ["just text", "more text"];
      const anchor = getTableAnchorForLine(lines, 0, 3);
      expect(anchor).toBeUndefined();
    });
  });

  describe("findTableHeaderLineIndex — various cursor positions", () => {
    it("finds header when cursor is on header line (next line is separator)", () => {
      const lines = ["| h1 | h2 |", "|---|---|", "| d1 | d2 |"];
      const anchor = getTableAnchorForLine(lines, 0, 3);
      expect(anchor).toBeDefined();
      expect(anchor!.row).toBe(0);
    });

    it("finds header when cursor is two lines below header (lineIndex - 1 is separator)", () => {
      const lines = ["| h1 | h2 |", "|---|---|", "| d1 | d2 |"];
      const anchor = getTableAnchorForLine(lines, 2, 3);
      expect(anchor).toBeDefined();
    });

    it("finds header when cursor is on separator line itself (lineIndex - 1 is header)", () => {
      // The separator line check returns undefined (filtered out by isTableSeparatorLine guard)
      const lines = ["| h1 | h2 |", "|---|---|", "| d1 | d2 |"];
      const anchor = getTableAnchorForLine(lines, 1, 3);
      // Separator lines return undefined
      expect(anchor).toBeUndefined();
    });

    it("returns null when no header found (single line without separator)", () => {
      const lines = ["| a | b |"];
      const anchor = getTableAnchorForLine(lines, 0, 2);
      expect(anchor).toBeUndefined();
    });

    it("returns null when separator has no table row above (separator at index 0)", () => {
      // lineIndex - 1 >= 0 && isTableSeparatorLine → true for index 1
      // lineIndex - 2 >= 0 && isTableRowLine(lines[0]) → lines[0] is NOT a table row
      const lines = ["|---|---|", "| d1 | d2 |"];
      // cursor on line 1 (data row): lineIndex-1=0 is separator, lineIndex-2=-1 < 0
      const anchor = getTableAnchorForLine(lines, 1, 3);
      expect(anchor).toBeUndefined();
    });

    it("returns null when on separator line with non-table-row above it", () => {
      // isTableSeparatorLine(lines[lineIndex]) && lineIndex-1 >= 0 → true
      // isTableRowLine(lines[lineIndex-1]) → false (it's plain text)
      const lines = ["plain text", "|---|---|"];
      const anchor = getTableAnchorForLine(lines, 1, 3);
      expect(anchor).toBeUndefined();
    });
  });

  describe("column detection", () => {
    it("detects first column when cursor is in first cell", () => {
      const lines = ["| a | b |", "|---|---|"];
      const anchor = getTableAnchorForLine(lines, 0, 2); // inside "a"
      expect(anchor).toBeDefined();
      expect(anchor!.col).toBe(0);
    });

    it("detects second column when cursor is in second cell", () => {
      const lines = ["| a | b |", "|---|---|"];
      const anchor = getTableAnchorForLine(lines, 0, 6); // inside "b"
      expect(anchor).toBeDefined();
      expect(anchor!.col).toBe(1);
    });

    it("falls back to col 0 when cursor before first cell", () => {
      const lines = ["| a | b |", "|---|---|"];
      // cursor at position 0 (before the leading pipe)
      const anchor = getTableAnchorForLine(lines, 0, 0);
      expect(anchor).toBeDefined();
      // With leading pipe, cellRanges start after "|", cursor at 0 is before rawStart
      expect(anchor!.col).toBe(0);
    });

    it("falls back to last col when cursor beyond all cells", () => {
      const lines = ["| a | b |", "|---|---|"];
      const anchor = getTableAnchorForLine(lines, 0, 20); // beyond end
      expect(anchor).toBeDefined();
      expect(anchor!.col).toBe(1); // last column
    });
  });

  describe("escaped pipes", () => {
    it("does not split on escaped pipe", () => {
      const lines = ["| a\\|b | c |", "|---|---|"];
      const anchor = getTableAnchorForLine(lines, 0, 3); // inside "a\|b"
      expect(anchor).toBeDefined();
      expect(anchor!.col).toBe(0);
    });
  });

  describe("tables without leading/trailing pipes", () => {
    it("handles table without leading pipe", () => {
      const lines = ["a | b", "---|---"];
      const anchor = getTableAnchorForLine(lines, 0, 0);
      expect(anchor).toBeDefined();
      expect(anchor!.col).toBe(0);
    });

    it("handles table without trailing pipe", () => {
      const lines = ["| a | b", "|---|---"];
      const anchor = getTableAnchorForLine(lines, 0, 6); // inside "b"
      expect(anchor).toBeDefined();
      // "b" is after the last separator, no trailing pipe — gets an extra cell range
      expect(anchor!.col).toBe(1);
    });
  });

  describe("offsetInCell calculation", () => {
    it("calculates offset correctly at start of cell content", () => {
      const lines = ["| abc | def |", "|-----|-----|"];
      const anchor = getTableAnchorForLine(lines, 0, 2); // at "a" in " abc "
      expect(anchor).toBeDefined();
      expect(anchor!.offsetInCell).toBe(0);
    });

    it("clamps negative offset to 0", () => {
      const lines = ["| abc | def |", "|-----|-----|"];
      // cursor in whitespace before content
      const anchor = getTableAnchorForLine(lines, 0, 1); // at space before "abc"
      expect(anchor).toBeDefined();
      expect(anchor!.offsetInCell).toBe(0);
    });

    it("clamps offset beyond content length", () => {
      const lines = ["| abc | def |", "|-----|-----|"];
      // cursor at space after "abc" but before pipe
      const anchor = getTableAnchorForLine(lines, 0, 5); // at space after "abc"
      expect(anchor).toBeDefined();
      expect(anchor!.offsetInCell).toBe(3); // clamped to "abc".length
    });
  });

  describe("separator line variations", () => {
    it("recognizes separator with colons (alignment)", () => {
      const lines = ["| Left | Center | Right |", "|:-----|:------:|------:|", "| a | b | c |"];
      const anchor = getTableAnchorForLine(lines, 2, 3);
      expect(anchor).toBeDefined();
    });

    it("recognizes separator with extra dashes", () => {
      const lines = ["| a | b |", "|------|------|", "| 1 | 2 |"];
      const anchor = getTableAnchorForLine(lines, 2, 3);
      expect(anchor).toBeDefined();
    });
  });

  describe("empty cells", () => {
    it("handles empty cell (no content between pipes)", () => {
      const lines = ["| | b |", "|---|---|"];
      const anchor = getTableAnchorForLine(lines, 0, 2);
      expect(anchor).toBeDefined();
    });
  });
});

describe("restoreTableColumnFromAnchor", () => {
  it("restores position in first cell", () => {
    const result = restoreTableColumnFromAnchor("| abc | def |", {
      col: 0,
      offsetInCell: 1,
    });
    expect(result).not.toBeNull();
    // "abc" starts at index 2, offset 1 -> position 3
    expect(result).toBe(3);
  });

  it("restores position in second cell", () => {
    const result = restoreTableColumnFromAnchor("| abc | def |", {
      col: 1,
      offsetInCell: 0,
    });
    expect(result).not.toBeNull();
    // "def" starts at index 8
    expect(result).toBe(8);
  });

  it("clamps col to valid range when too high", () => {
    const result = restoreTableColumnFromAnchor("| a | b |", {
      col: 99,
      offsetInCell: 0,
    });
    expect(result).not.toBeNull();
    // Should clamp to last column (col 1)
  });

  it("clamps offsetInCell to cell content length", () => {
    const result = restoreTableColumnFromAnchor("| ab |", {
      col: 0,
      offsetInCell: 100,
    });
    expect(result).not.toBeNull();
    // "ab" content length is 2, clamped to 2
  });

  it("returns null for line with no pipes", () => {
    const result = restoreTableColumnFromAnchor("no pipes here", {
      col: 0,
      offsetInCell: 0,
    });
    expect(result).toBeNull();
  });

  it("handles empty cell content", () => {
    const result = restoreTableColumnFromAnchor("| | b |", {
      col: 0,
      offsetInCell: 0,
    });
    expect(result).not.toBeNull();
  });

  it("handles trailing content without pipe", () => {
    const result = restoreTableColumnFromAnchor("| a | b", {
      col: 1,
      offsetInCell: 0,
    });
    expect(result).not.toBeNull();
  });
});
