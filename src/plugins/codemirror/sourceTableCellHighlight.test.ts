/**
 * Tests for sourceTableCellHighlight — table cell highlight decoration.
 *
 * Tests getCellRange logic and the plugin:
 * - Cell range calculation for various column indices
 * - Plugin produces decorations inside tables, nothing outside
 * - Separator row is not highlighted
 * - Update on selection / doc change
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const mockGetSourceTableInfo = vi.fn<() => {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  rowIndex: number;
  colIndex: number;
  colCount: number;
  lines: string[];
} | null>(() => null);

vi.mock("@/plugins/sourceContextDetection/tableDetection", () => ({
  getSourceTableInfo: (..._args: unknown[]) => mockGetSourceTableInfo(),
}));

vi.mock("@/utils/tableParser", () => ({
  // Backslash-parity check — mirrors the real helper. An even run of `\` before
  // the trailing `|` (including zero) ⇒ real delimiter.
  endsWithDelimiterPipe: (content: string) => {
    if (!content.endsWith("|")) return false;
    let run = 0;
    let i = content.length - 2;
    while (i >= 0 && content[i] === "\\") {
      run++;
      i--;
    }
    return run % 2 === 0;
  },
  splitTableCells: (content: string) => {
    // Simple split on unescaped pipe — mirrors the real logic for test purposes
    const cells: string[] = [];
    let current = "";
    let escaped = false;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        current += ch;
        escaped = true;
        continue;
      }
      if (ch === "|") {
        cells.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current);
    return cells;
  },
}));

import { createSourceTableCellHighlightPlugin } from "./sourceTableCellHighlight";

let pluginRef: ReturnType<typeof createSourceTableCellHighlightPlugin>;

function createView(content: string, cursorPos?: number): EditorView {
  pluginRef = createSourceTableCellHighlightPlugin();
  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos ?? 0 },
    extensions: [pluginRef],
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

function getDecorationSpecs(view: EditorView): Array<{ from: number; to: number; class: string }> {
  const value = view.plugin(pluginRef);
  if (!value) return [];

  const result: Array<{ from: number; to: number; class: string }> = [];
  const iter = value.decorations.iter();
  while (iter.value) {
    const spec = iter.value.spec as { class?: string };
    result.push({ from: iter.from, to: iter.to, class: spec.class ?? "" });
    iter.next();
  }
  return result;
}

const createdViews: EditorView[] = [];
function tracked(content: string, cursorPos?: number): EditorView {
  const v = createView(content, cursorPos);
  createdViews.push(v);
  return v;
}

afterEach(() => {
  createdViews.forEach((v) => v.destroy());
  createdViews.length = 0;
  vi.clearAllMocks();
});

describe("sourceTableCellHighlight", () => {
  describe("no table at cursor", () => {
    it("produces no decorations when cursor is not in a table", () => {
      mockGetSourceTableInfo.mockReturnValue(null);
      const view = tracked("Hello world");
      expect(getDecorationSpecs(view)).toHaveLength(0);
    });

    it("produces no decorations for empty document", () => {
      mockGetSourceTableInfo.mockReturnValue(null);
      const view = tracked("");
      expect(getDecorationSpecs(view)).toHaveLength(0);
    });
  });

  describe("separator row (rowIndex === 1)", () => {
    it("produces no decorations when cursor is on separator row", () => {
      mockGetSourceTableInfo.mockReturnValue({
        start: 0,
        end: 80,
        startLine: 0,
        endLine: 2,
        rowIndex: 1,
        colIndex: 0,
        colCount: 2,
        lines: [
          "| H1 | H2 |",
          "|-----|-----|",
          "| A  | B   |",
        ],
      });
      const content = "| H1 | H2 |\n|-----|-----|\n| A  | B   |";
      const view = tracked(content, 15);
      expect(getDecorationSpecs(view)).toHaveLength(0);
    });
  });

  describe("header row highlight", () => {
    it("highlights first cell (colIndex 0) in header row", () => {
      mockGetSourceTableInfo.mockReturnValue({
        start: 0,
        end: 80,
        startLine: 0,
        endLine: 2,
        rowIndex: 0,
        colIndex: 0,
        colCount: 2,
        lines: [
          "| H1 | H2 |",
          "|-----|-----|",
          "| A  | B   |",
        ],
      });
      const content = "| H1 | H2 |\n|-----|-----|\n| A  | B   |";
      const view = tracked(content, 3);
      const specs = getDecorationSpecs(view);
      expect(specs.length).toBe(1);
      expect(specs[0].class).toBe("table-cell-highlight");
    });

    it("highlights second cell (colIndex 1) in header row", () => {
      mockGetSourceTableInfo.mockReturnValue({
        start: 0,
        end: 80,
        startLine: 0,
        endLine: 2,
        rowIndex: 0,
        colIndex: 1,
        colCount: 2,
        lines: [
          "| H1 | H2 |",
          "|-----|-----|",
          "| A  | B   |",
        ],
      });
      const content = "| H1 | H2 |\n|-----|-----|\n| A  | B   |";
      const view = tracked(content, 7);
      const specs = getDecorationSpecs(view);
      expect(specs.length).toBe(1);
      expect(specs[0].class).toBe("table-cell-highlight");
    });
  });

  describe("data row highlight", () => {
    it("highlights cell in data row (rowIndex 2)", () => {
      mockGetSourceTableInfo.mockReturnValue({
        start: 0,
        end: 80,
        startLine: 0,
        endLine: 2,
        rowIndex: 2,
        colIndex: 0,
        colCount: 2,
        lines: [
          "| H1 | H2 |",
          "|-----|-----|",
          "| A  | B   |",
        ],
      });
      const content = "| H1 | H2 |\n|-----|-----|\n| A  | B   |";
      const view = tracked(content, 30);
      const specs = getDecorationSpecs(view);
      expect(specs.length).toBe(1);
      expect(specs[0].class).toBe("table-cell-highlight");
    });
  });

  describe("out-of-range column index", () => {
    it("produces no decorations for out-of-range colIndex", () => {
      mockGetSourceTableInfo.mockReturnValue({
        start: 0,
        end: 80,
        startLine: 0,
        endLine: 2,
        rowIndex: 0,
        colIndex: 99,
        colCount: 2,
        lines: [
          "| H1 | H2 |",
          "|-----|-----|",
          "| A  | B   |",
        ],
      });
      const content = "| H1 | H2 |\n|-----|-----|\n| A  | B   |";
      const view = tracked(content, 3);
      expect(getDecorationSpecs(view)).toHaveLength(0);
    });
  });

  describe("update on selection change", () => {
    it("rebuilds decorations on selection change", () => {
      mockGetSourceTableInfo.mockReturnValue(null);
      const content = "| H1 | H2 |\n|-----|-----|\n| A  | B   |";
      const view = tracked(content, 0);
      expect(getDecorationSpecs(view)).toHaveLength(0);

      mockGetSourceTableInfo.mockReturnValue({
        start: 0,
        end: 80,
        startLine: 0,
        endLine: 2,
        rowIndex: 0,
        colIndex: 0,
        colCount: 2,
        lines: [
          "| H1 | H2 |",
          "|-----|-----|",
          "| A  | B   |",
        ],
      });

      view.dispatch({ selection: { anchor: 3 } });
      const specs = getDecorationSpecs(view);
      expect(specs.length).toBe(1);
    });
  });

  // Exercises both branches of the trailing-delimiter strip (endsWithDelimiterPipe):
  // a real delimiter after a literal backslash (strip) vs an escaped pipe (no strip).
  describe("escaped/real trailing pipe (#962)", () => {
    const info = (lines: string[], colIndex: number) => ({
      start: 0,
      end: 80,
      startLine: 0,
      endLine: 0,
      rowIndex: 0,
      colIndex,
      colCount: 2,
      lines,
    });

    it("strips a real delimiter pipe even when the last cell ends with a literal backslash", () => {
      // Row: | a | b \\|  → cell 1 is " b \\" (b + literal backslash), trailing delimiter.
      const content = "| a | b \\\\|";
      mockGetSourceTableInfo.mockReturnValue(info([content], 1));
      const view = tracked(content, 6);
      const specs = getDecorationSpecs(view);
      expect(specs).toHaveLength(1);
      // Highlight covers " b \\" and stops before the trailing delimiter pipe.
      expect(content.slice(specs[0].from, specs[0].to)).toBe(" b \\\\");
      expect(content[specs[0].to]).toBe("|");
    });

    it("keeps an escaped pipe inside the last cell (no strip)", () => {
      // Row: | a | b \|  → cell 1 is " b \|" (escaped pipe is cell content, no trailing delimiter).
      const content = "| a | b \\|";
      mockGetSourceTableInfo.mockReturnValue(info([content], 1));
      const view = tracked(content, 6);
      const specs = getDecorationSpecs(view);
      expect(specs).toHaveLength(1);
      expect(content.slice(specs[0].from, specs[0].to)).toBe(" b \\|");
    });
  });
});
