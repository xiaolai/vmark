import { describe, it, expect } from "vitest";
import type { SourceTableInfo } from "./tableTypes";
import {
  buildEmptyCells,
  computeColCount,
  computeColumnWidths,
  formatAlignmentCell,
  getMinWidthForAlignment,
  parseAlignment,
  parseAlignments,
  renderTableLines,
} from "./tableFormat";

function makeInfo(lines: string[], colCount: number): SourceTableInfo {
  return {
    start: 0,
    end: lines.join("\n").length,
    startLine: 0,
    endLine: lines.length - 1,
    rowIndex: 0,
    colIndex: 0,
    colCount,
    lines,
  };
}

describe("parseAlignment", () => {
  it.each([
    { cell: "---", expected: "left" as const },
    { cell: ":--", expected: "left" as const },
    { cell: "--:", expected: "right" as const },
    { cell: ":-:", expected: "center" as const },
    { cell: "", expected: "left" as const },
  ])("parses '$cell' as $expected", ({ cell, expected }) => {
    expect(parseAlignment(cell)).toBe(expected);
  });
});

describe("formatAlignmentCell", () => {
  it.each([
    { alignment: "center" as const, width: 5, explicitLeft: false, expected: ":---:" },
    { alignment: "center" as const, width: 12, explicitLeft: false, expected: ":----------:" },
    { alignment: "right" as const, width: 4, explicitLeft: false, expected: "---:" },
    { alignment: "right" as const, width: 12, explicitLeft: false, expected: "-----------:" },
    { alignment: "left" as const, width: 5, explicitLeft: false, expected: "-----" },
    { alignment: "left" as const, width: 5, explicitLeft: true, expected: ":----" },
    // Width below the alignment minimum: the dash floor keeps the cell legal.
    { alignment: "center" as const, width: 3, explicitLeft: false, expected: ":---:" },
  ])(
    "$alignment at width $width (explicitLeft=$explicitLeft) → '$expected'",
    ({ alignment, width, explicitLeft, expected }) => {
      expect(formatAlignmentCell(alignment, width, explicitLeft)).toBe(expected);
    }
  );
});

describe("getMinWidthForAlignment", () => {
  it.each([
    { alignment: "left" as const, expected: 3 },
    { alignment: "right" as const, expected: 4 },
    { alignment: "center" as const, expected: 5 },
  ])("$alignment → $expected", ({ alignment, expected }) => {
    expect(getMinWidthForAlignment(alignment)).toBe(expected);
  });
});

describe("buildEmptyCells", () => {
  it("matches inner column widths of a formatted header", () => {
    const info = makeInfo(["| A   | B   |", "| --- | --- |"], 2);
    // Inner width is 3 ("A" + two pad spaces); the wrapper spaces around each
    // cell belong to the row renderer, not the cell.
    expect(buildEmptyCells(info)).toEqual(["   ", "   "]);
  });

  it("floors missing columns at width 3", () => {
    const info = makeInfo(["| A |", "| --- |"], 3);
    expect(buildEmptyCells(info)).toEqual(["   ", "   ", "   "]);
  });

  it("handles a header without leading or trailing pipes", () => {
    const info = makeInfo(["Aaaa | Bb", "--- | ---"], 2);
    const cells = buildEmptyCells(info);
    expect(cells[0].length).toBe(4);
    expect(cells[1].length).toBe(3);
  });
});

describe("computeColCount", () => {
  it("returns the declared count when no row is wider", () => {
    expect(computeColCount([["a", "b"], ["---", "---"]], 2)).toBe(2);
  });

  it("grows to the widest row so extra cells are never truncated", () => {
    expect(computeColCount([["a", "b"], ["---", "---"], ["a", "b", "extra"]], 2)).toBe(3);
  });
});

describe("parseAlignments", () => {
  it("defaults missing separator cells to left", () => {
    expect(parseAlignments([":-:", "--:"], 3)).toEqual(["center", "right", "left"]);
  });
});

describe("computeColumnWidths", () => {
  it("uses the widest content cell, skipping the separator row", () => {
    const rows = [
      ["A", "B"],
      ["-------------", "---"],
      ["long content", "b"],
    ];
    expect(computeColumnWidths(rows, ["left", "left"])).toEqual([12, 3]);
  });

  it("floors each column at the alignment minimum", () => {
    const rows = [["A", "B"], ["---", "---"], ["a", "b"]];
    expect(computeColumnWidths(rows, ["center", "right"])).toEqual([5, 4]);
  });
});

describe("renderTableLines", () => {
  it("renders every row padded to the alignment count", () => {
    const rows = [
      ["A", "B"],
      ["---", "---"],
      ["a", "b", "extra"],
    ];
    const alignments = parseAlignments(rows[1], 3);
    const widths = computeColumnWidths(rows, alignments);
    expect(renderTableLines(rows, alignments, widths)).toEqual([
      "| A   | B   |       |",
      "| --- | --- | ----- |",
      "| a   | b   | extra |",
    ]);
  });
});
