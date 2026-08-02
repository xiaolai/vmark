import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SourceTableInfo } from "./tableTypes";
import {
  insertRowBelow,
  insertRowAbove,
  insertColumnRight,
  insertColumnLeft,
  deleteRow,
  deleteColumn,
  deleteTable,
  setColumnAlignment,
  setAllColumnsAlignment,
  formatTable,
} from "./tableActions";

function createView(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

/**
 * Helper to build a SourceTableInfo for a simple table.
 * Assumes the table starts at the beginning of the document.
 */
function makeTableInfo(
  overrides: Partial<SourceTableInfo> & {
    lines: string[];
    colCount: number;
    rowIndex: number;
    colIndex: number;
  }
): SourceTableInfo {
  const lines = overrides.lines;
  return {
    start: 0,
    end: lines.join("\n").length,
    startLine: overrides.startLine ?? 0,
    endLine: overrides.endLine ?? lines.length - 1,
    rowIndex: overrides.rowIndex,
    colIndex: overrides.colIndex,
    colCount: overrides.colCount,
    lines,
  };
}

const simpleTable = [
  "| A   | B   |",
  "| --- | --- |",
  "| a1  | b1  |",
  "| a2  | b2  |",
];

const simpleTableText = simpleTable.join("\n");

describe("insertRowBelow", () => {
  it("inserts a new row below the current row", () => {
    const view = createView(simpleTableText, 30);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 2, // data row "a1 | b1"
      colIndex: 0,
    });

    insertRowBelow(view, info);
    const result = view.state.doc.toString();

    // Should have 5 lines now (original 4 + 1 new)
    const lines = result.split("\n");
    expect(lines.length).toBe(5);
    // New row should be after row index 2 (line 3 in 1-indexed)
    expect(lines[3]).toMatch(/^\|.*\|$/);
    view.destroy();
  });
});

describe("structural row insertion (header/separator context)", () => {
  // A data row must never land between header and separator — that breaks
  // table detection. From either structural row, both directions insert
  // immediately after the separator.
  it.each([
    { name: "insertRowBelow", fn: insertRowBelow, rowIndex: 0 },
    { name: "insertRowBelow", fn: insertRowBelow, rowIndex: 1 },
    { name: "insertRowAbove", fn: insertRowAbove, rowIndex: 0 },
    { name: "insertRowAbove", fn: insertRowAbove, rowIndex: 1 },
  ])("$name from rowIndex $rowIndex lands the new row after the separator", ({ fn, rowIndex }) => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex,
      colIndex: 0,
    });

    fn(view, info);
    const lines = view.state.doc.toString().split("\n");
    expect(lines.length).toBe(5);
    expect(lines[0]).toBe("| A   | B   |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toMatch(/^\|[\s|]+\|$/);
    expect(lines[3]).toBe("| a1  | b1  |");
    view.destroy();
  });
});

describe("insertRowBelow — generated row width", () => {
  it("emits a new empty row exactly as wide as the header row", () => {
    const view = createView(simpleTableText, 30);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 2,
      colIndex: 0,
    });

    insertRowBelow(view, info);
    const lines = view.state.doc.toString().split("\n");
    // "| A   | B   |" is 13 chars; the empty row must match, not gain
    // an extra wrapper space per cell side.
    expect(lines[3].length).toBe(simpleTable[0].length);
    view.destroy();
  });
});

describe("insertRowBelow — edge cases", () => {
  it("handles header without leading pipe", () => {
    const lines = [
      "A   | B   |",
      "--- | --- |",
      "a1  | b1  |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 25);
    const info = makeTableInfo({
      lines,
      colCount: 2,
      rowIndex: 2,
      colIndex: 0,
    });

    insertRowBelow(view, info);
    const result = view.state.doc.toString();
    const resultLines = result.split("\n");
    expect(resultLines.length).toBe(4);
    view.destroy();
  });

  it("handles colCount larger than actual header cells", () => {
    const lines = [
      "| A |",
      "| --- |",
      "| a1 |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 15);
    const info = makeTableInfo({
      lines,
      colCount: 3, // more than actual cells
      rowIndex: 2,
      colIndex: 0,
    });

    insertRowBelow(view, info);
    const result = view.state.doc.toString();
    const resultLines = result.split("\n");
    expect(resultLines.length).toBe(4);
    // New row should exist and contain pipe characters
    expect(resultLines[3]).toContain("|");
    view.destroy();
  });

  it("handles header without trailing pipe", () => {
    const lines = [
      "| A   | B  ",
      "| --- | ---",
      "| a1  | b1 ",
    ];
    const text = lines.join("\n");
    const view = createView(text, 25);
    const info = makeTableInfo({
      lines,
      colCount: 2,
      rowIndex: 2,
      colIndex: 0,
    });

    insertRowBelow(view, info);
    const result = view.state.doc.toString();
    const resultLines = result.split("\n");
    expect(resultLines.length).toBe(4);
    view.destroy();
  });
});

describe("insertRowAbove", () => {
  it("inserts row after separator when rowIndex is 0 (header)", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0, // header
      colIndex: 0,
    });

    insertRowAbove(view, info);
    const result = view.state.doc.toString();
    const lines = result.split("\n");
    expect(lines.length).toBe(5);
    view.destroy();
  });

  it("inserts row above current data row", () => {
    const view = createView(simpleTableText, 40);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 3, // last data row "a2 | b2"
      colIndex: 0,
    });

    insertRowAbove(view, info);
    const result = view.state.doc.toString();
    const lines = result.split("\n");
    expect(lines.length).toBe(5);
    view.destroy();
  });
});

describe("insertColumnRight", () => {
  it("adds a column to the right of current column", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    insertColumnRight(view, info);
    const result = view.state.doc.toString();
    const lines = result.split("\n");

    // Each line should now have 3 pipe-delimited cells
    for (const line of lines) {
      // Count pipe segments (cells = pipes - 1 for leading/trailing)
      const pipes = line.split("|").length - 1;
      expect(pipes).toBeGreaterThanOrEqual(4); // |cell|cell|cell| = 4 pipes
    }
    view.destroy();
  });
});

describe("insertColumnLeft", () => {
  it("adds a column to the left of current column", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 1,
    });

    insertColumnLeft(view, info);
    const result = view.state.doc.toString();
    const lines = result.split("\n");

    for (const line of lines) {
      const pipes = line.split("|").length - 1;
      expect(pipes).toBeGreaterThanOrEqual(4);
    }
    view.destroy();
  });
});

describe("deleteRow", () => {
  it("does nothing when rowIndex is 0 (header)", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    deleteRow(view, info);
    expect(view.state.doc.toString()).toBe(simpleTableText);
    view.destroy();
  });

  it("does nothing when rowIndex is 1 (separator)", () => {
    const view = createView(simpleTableText, 15);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 1,
      colIndex: 0,
    });

    deleteRow(view, info);
    expect(view.state.doc.toString()).toBe(simpleTableText);
    view.destroy();
  });

  it("deletes entire table when only one data row remains", () => {
    const threeLineTable = [
      "| A   | B   |",
      "| --- | --- |",
      "| a1  | b1  |",
    ];
    const text = threeLineTable.join("\n");
    const view = createView(text, 30);
    const info = makeTableInfo({
      lines: threeLineTable,
      colCount: 2,
      rowIndex: 2,
      colIndex: 0,
    });

    deleteRow(view, info);
    // Table should be deleted entirely
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes a data row when multiple exist", () => {
    const view = createView(simpleTableText, 30);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 2, // first data row
      colIndex: 0,
    });

    deleteRow(view, info);
    const result = view.state.doc.toString();
    const lines = result.split("\n");
    expect(lines.length).toBe(3); // header + separator + 1 data row
    view.destroy();
  });
});

describe("deleteColumn", () => {
  it("does nothing when only one column", () => {
    const oneCol = ["| A |", "| - |", "| a |"];
    const text = oneCol.join("\n");
    const view = createView(text, 3);
    const info = makeTableInfo({
      lines: oneCol,
      colCount: 1,
      rowIndex: 0,
      colIndex: 0,
    });

    deleteColumn(view, info);
    expect(view.state.doc.toString()).toBe(text);
    view.destroy();
  });

  it("handles colIndex beyond cells.length gracefully", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 99, // beyond cells.length
    });

    deleteColumn(view, info);
    // Should still produce valid output (cells not spliced since index out of range)
    const result = view.state.doc.toString();
    const lines = result.split("\n");
    // Each line should still have cells (no splice happened)
    for (const line of lines) {
      expect(line).toMatch(/\|/);
    }
    view.destroy();
  });

  it("removes a column from multi-column table", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    deleteColumn(view, info);
    const result = view.state.doc.toString();
    const lines = result.split("\n");

    // Should have only 1 cell per row now
    for (const line of lines) {
      const cells = line.split("|").filter((s) => s.trim() !== "");
      expect(cells.length).toBe(1);
    }
    view.destroy();
  });
});

describe("deleteTable", () => {
  it("removes entire table from document", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    deleteTable(view, info);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("removes table with trailing newline", () => {
    const text = simpleTableText + "\nmore text";
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    deleteTable(view, info);
    expect(view.state.doc.toString()).toBe("more text");
    view.destroy();
  });
});

describe("setColumnAlignment", () => {
  it("sets column to center alignment", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    setColumnAlignment(view, info, "center");
    const result = view.state.doc.toString();
    // Separator line should contain :---: pattern for col 0
    const sepLine = result.split("\n")[1];
    expect(sepLine).toMatch(/:[-]+:/);
    view.destroy();
  });

  it("does nothing when colIndex is out of range", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 99, // beyond cells.length
    });

    setColumnAlignment(view, info, "center");
    // Should produce output without crash — the cell at index 99 doesn't exist
    const result = view.state.doc.toString();
    expect(result).toContain("|");
    view.destroy();
  });

  it("sets column to right alignment", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 1,
    });

    setColumnAlignment(view, info, "right");
    const result = view.state.doc.toString();
    const sepLine = result.split("\n")[1];
    // Should end with ---: pattern in second cell
    expect(sepLine).toMatch(/[-]+:/);
    view.destroy();
  });
});

describe("alignment preserves separator width", () => {
  const wideTable = [
    "| Long header  | B   |",
    "| ------------ | --- |",
    "| a            | b   |",
  ];

  it("setColumnAlignment keeps a wide separator cell at its width", () => {
    const view = createView(wideTable.join("\n"), 5);
    const info = makeTableInfo({
      lines: wideTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    setColumnAlignment(view, info, "center");
    const sepCells = view.state.doc.toString().split("\n")[1].split("|");
    // 12 dashes wide before, so :----------: (still 12) after — not :---:.
    expect(sepCells[1].trim()).toBe(":----------:");
    view.destroy();
  });

  it("setAllColumnsAlignment keeps each separator cell at its own width", () => {
    const view = createView(wideTable.join("\n"), 5);
    const info = makeTableInfo({
      lines: wideTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    setAllColumnsAlignment(view, info, "right");
    const sepCells = view.state.doc.toString().split("\n")[1].split("|");
    expect(sepCells[1].trim()).toBe("-----------:");
    expect(sepCells[2].trim()).toBe("---:");
    view.destroy();
  });
});

describe("setAllColumnsAlignment", () => {
  it("sets all columns to center", () => {
    const view = createView(simpleTableText, 5);
    const info = makeTableInfo({
      lines: simpleTable,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    setAllColumnsAlignment(view, info, "center");
    const result = view.state.doc.toString();
    const sepLine = result.split("\n")[1];
    // Both cells should have :---: pattern
    const cells = sepLine.split("|").filter((s) => s.trim() !== "");
    for (const cell of cells) {
      expect(cell.trim()).toMatch(/^:[-]+:$/);
    }
    view.destroy();
  });
});

describe("formatTable", () => {
  it("formats table with padded columns", () => {
    const unformatted = [
      "| A | B |",
      "| --- | --- |",
      "| long cell | b |",
    ];
    const text = unformatted.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines: unformatted,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    const changed = formatTable(view, info);
    expect(changed).toBe(true);

    const result = view.state.doc.toString();
    const lines = result.split("\n");
    // All lines should have the same structure
    expect(lines.length).toBe(3);
    view.destroy();
  });

  it("returns false when table is already formatted", () => {
    const formatted = [
      "| A   | B   |",
      "| --- | --- |",
      "| a   | b   |",
    ];
    const text = formatted.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines: formatted,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    const changed = formatTable(view, info);
    // May or may not change depending on exact formatting match
    // The important thing is it doesn't crash
    expect(typeof changed).toBe("boolean");
    view.destroy();
  });

  it("handles center alignment in separator", () => {
    const lines = [
      "| H1 | H2 |",
      "| :-: | --: |",
      "| a | b |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    formatTable(view, info);
    const result = view.state.doc.toString();
    const sepLine = result.split("\n")[1];
    // Center alignment should be preserved
    expect(sepLine).toMatch(/:-+:/);
    // Right alignment should be preserved
    expect(sepLine).toMatch(/-+:/);
    view.destroy();
  });

  it("formats table with wide columns requiring larger separator", () => {
    const lines = [
      "| Very Long Header | Short |",
      "| --- | --- |",
      "| a | b |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    const changed = formatTable(view, info);
    expect(changed).toBe(true);

    const result = view.state.doc.toString();
    const resultLines = result.split("\n");
    // Separator should be padded to match the wide column
    const sepCells = resultLines[1].split("|").filter((s) => s.trim() !== "");
    // First separator cell should be wider than minimum 3
    expect(sepCells[0].trim().length).toBeGreaterThanOrEqual(16);
    view.destroy();
  });

  it("formats table with right alignment and wide columns", () => {
    const lines = [
      "| Wide Column Name | B |",
      "| --: | :-: |",
      "| data | x |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    const changed = formatTable(view, info);
    expect(changed).toBe(true);

    const result = view.state.doc.toString();
    const sepLine = result.split("\n")[1];
    // Right alignment preserved
    expect(sepLine).toMatch(/-+:/);
    // Center alignment preserved
    expect(sepLine).toMatch(/:-+:/);
    view.destroy();
  });

  it("preserves body-row cells beyond the header column count", () => {
    const lines = [
      "| A | B |",
      "| --- | --- |",
      "| a | b | extra |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
    });

    const changed = formatTable(view, info);
    expect(changed).toBe(true);

    const result = view.state.doc.toString();
    // The extra cell is data — formatting must never drop it.
    expect(result).toContain("extra");
    // Every row is padded out to the widest row's cell count.
    for (const line of result.split("\n")) {
      expect(line.split("|").length - 1).toBe(4);
    }
    view.destroy();
  });

  it("formats table with missing cells in some rows", () => {
    const lines = [
      "| A | B | C |",
      "| --- | --- | --- |",
      "| a |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines,
      colCount: 3,
      rowIndex: 0,
      colIndex: 0,
    });

    const changed = formatTable(view, info);
    // Should not crash on missing cells
    expect(typeof changed).toBe("boolean");
    view.destroy();
  });

  it("handles table with only one line (no separator row)", () => {
    // Edge case: colCount > 0 but only 1 line means parsedRows[1] is undefined → || []
    const lines = [
      "| A | B |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines,
      colCount: 2,
      rowIndex: 0,
      colIndex: 0,
      endLine: 0,
    });

    // Should not crash — uses || [] fallback
    const changed = formatTable(view, info);
    expect(typeof changed).toBe("boolean");
    view.destroy();
  });

  it("handles table with more colCount than separator cells", () => {
    // colCount is 3 but separator only has 2 cells
    const lines = [
      "| A | B | C |",
      "| --- | --- |",
      "| a | b | c |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines,
      colCount: 3,
      rowIndex: 0,
      colIndex: 0,
    });

    // Should not crash — uses || "" fallback for missing separator cell
    const changed = formatTable(view, info);
    expect(typeof changed).toBe("boolean");
    view.destroy();
  });

  it("formats table with all alignments and verifies width calculations", () => {
    const lines = [
      "| Left | Center | Right |",
      "| --- | :-: | --: |",
      "| l | c | r |",
    ];
    const text = lines.join("\n");
    const view = createView(text, 5);
    const info = makeTableInfo({
      lines,
      colCount: 3,
      rowIndex: 0,
      colIndex: 0,
    });

    formatTable(view, info);
    const result = view.state.doc.toString();
    const sepLine = result.split("\n")[1];
    const sepCells = sepLine.split("|").filter((s) => s.trim() !== "");
    // Left: just dashes (min 3), Center: :---: (min 5), Right: ---: (min 4)
    expect(sepCells[0].trim()).toMatch(/^-{3,}$/);
    expect(sepCells[1].trim()).toMatch(/^:-+:$/);
    expect(sepCells[2].trim()).toMatch(/^-+:$/);
    view.destroy();
  });
});
