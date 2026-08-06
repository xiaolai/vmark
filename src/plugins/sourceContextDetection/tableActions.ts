/**
 * Table Actions for Source Mode
 *
 * View-coupled functions that modify markdown tables in raw text. The pure
 * formatting arithmetic (alignment parsing, width calculation, row
 * rendering) lives in tableFormat.ts.
 *
 * @coordinates-with sourceContextDetection/tableFormat.ts — pure formatting helpers
 */

import type { EditorView } from "@codemirror/view";
import { getDisplayWidth } from "@/utils/stringWidth";
import { parseTableRow } from "@/utils/tableParser";
import type { SourceTableInfo, TableAlignment } from "./tableTypes";
import {
  buildEmptyCells,
  computeColCount,
  computeColumnWidths,
  formatAlignmentCell,
  parseAlignments,
  renderTableLines,
} from "./tableFormat";

/**
 * Insert an empty data row adjacent to the current row.
 *
 * From the header or the separator (rowIndex <= 1) there is no legal data
 * position "above" or "below" within the header block — a data row placed
 * between header and separator breaks table detection entirely — so both
 * directions insert immediately after the separator instead.
 */
function insertEmptyRow(
  view: EditorView,
  info: SourceTableInfo,
  where: "above" | "below"
): void {
  const doc = view.state.doc;
  const newRow = `| ${buildEmptyCells(info).join(" | ")} |`;

  if (info.rowIndex <= 1) {
    const separatorLine = doc.line(info.startLine + 2);
    view.dispatch({
      changes: { from: separatorLine.to, insert: `\n${newRow}` },
      selection: { anchor: separatorLine.to + 3 },
    });
    view.focus();
    return;
  }

  const currentLine = doc.line(info.startLine + 1 + info.rowIndex);
  if (where === "below") {
    view.dispatch({
      changes: { from: currentLine.to, insert: `\n${newRow}` },
      selection: { anchor: currentLine.to + 3 },
    });
  } else {
    view.dispatch({
      changes: { from: currentLine.from, insert: `${newRow}\n` },
      selection: { anchor: currentLine.from + 2 },
    });
  }
  view.focus();
}

/**
 * Insert a new row below current position.
 */
export function insertRowBelow(view: EditorView, info: SourceTableInfo): void {
  insertEmptyRow(view, info, "below");
}

/**
 * Insert a new row above current position.
 */
export function insertRowAbove(view: EditorView, info: SourceTableInfo): void {
  insertEmptyRow(view, info, "above");
}

/**
 * Insert an empty column into every table row, at the index `indexFor`
 * computes from that row's cells. The separator row gets dashes.
 */
function insertColumn(
  view: EditorView,
  info: SourceTableInfo,
  indexFor: (cells: string[]) => number
): void {
  const changes: { from: number; to: number; insert: string }[] = [];
  const doc = view.state.doc;

  for (let i = 0; i < info.lines.length; i++) {
    const line = doc.line(info.startLine + 1 + i);
    const cells = parseTableRow(info.lines[i]);

    cells.splice(indexFor(cells), 0, i === 1 ? "-----" : "     ");

    changes.push({ from: line.from, to: line.to, insert: `| ${cells.join(" | ")} |` });
  }

  view.dispatch({ changes });
  view.focus();
}

/**
 * Insert a new column to the right of current position.
 */
export function insertColumnRight(view: EditorView, info: SourceTableInfo): void {
  insertColumn(view, info, (cells) => Math.min(info.colIndex + 1, cells.length));
}

/**
 * Insert a new column to the left of current position.
 */
export function insertColumnLeft(view: EditorView, info: SourceTableInfo): void {
  insertColumn(view, info, () => info.colIndex);
}

/**
 * Delete current row.
 * If only one data row remains (header + separator + 1 data), deletes entire table.
 */
export function deleteRow(view: EditorView, info: SourceTableInfo): void {
  // Can't delete header or separator
  if (info.rowIndex <= 1) return;

  // If only header + separator + 1 data row, delete entire table
  if (info.lines.length <= 3) {
    deleteTable(view, info);
    return;
  }

  const doc = view.state.doc;
  const lineNum = info.startLine + 1 + info.rowIndex;
  const line = doc.line(lineNum);

  const deleteFrom = line.from - 1;
  const deleteTo = line.to;

  view.dispatch({
    changes: { from: deleteFrom, to: deleteTo },
  });

  view.focus();
}

/**
 * Delete current column.
 */
export function deleteColumn(view: EditorView, info: SourceTableInfo): void {
  if (info.colCount <= 1) return;

  const changes: { from: number; to: number; insert: string }[] = [];
  const doc = view.state.doc;

  for (let i = 0; i < info.lines.length; i++) {
    const lineNum = info.startLine + 1 + i;
    const line = doc.line(lineNum);
    const cells = parseTableRow(info.lines[i]);

    if (info.colIndex < cells.length) {
      cells.splice(info.colIndex, 1);
    }

    const newLine = `| ${cells.join(" | ")} |`;
    changes.push({ from: line.from, to: line.to, insert: newLine });
  }

  view.dispatch({ changes });
  view.focus();
}

/**
 * Delete entire table.
 */
export function deleteTable(view: EditorView, info: SourceTableInfo): void {
  const doc = view.state.doc;
  const startLine = doc.line(info.startLine + 1);
  const endLine = doc.line(info.endLine + 1);

  let deleteTo = endLine.to;
  if (deleteTo < doc.length && doc.sliceString(deleteTo, deleteTo + 1) === "\n") {
    deleteTo++;
  }

  view.dispatch({
    changes: { from: startLine.from, to: deleteTo },
  });

  view.focus();
}

/**
 * Rewrite the separator row through a per-cell transform, then dispatch and
 * refocus. Shared by the single-column and all-columns alignment setters.
 */
function rewriteSeparatorRow(
  view: EditorView,
  info: SourceTableInfo,
  transform: (cell: string, col: number) => string
): void {
  const doc = view.state.doc;
  const separatorLine = doc.line(info.startLine + 2);
  const cells = parseTableRow(info.lines[1]).map(transform);

  view.dispatch({
    changes: {
      from: separatorLine.from,
      to: separatorLine.to,
      insert: `| ${cells.join(" | ")} |`,
    },
  });

  view.focus();
}

/**
 * Rebuild one separator cell with the requested alignment, preserving the
 * cell's current display width — a hardcoded width shrank wide columns and
 * broke the table's visual alignment.
 */
function alignedSeparatorCell(cell: string, alignment: TableAlignment): string {
  return formatAlignmentCell(alignment, getDisplayWidth(cell), true);
}

/**
 * Set alignment for current column.
 */
export function setColumnAlignment(
  view: EditorView,
  info: SourceTableInfo,
  alignment: TableAlignment
): void {
  rewriteSeparatorRow(view, info, (cell, col) =>
    col === info.colIndex ? alignedSeparatorCell(cell, alignment) : cell
  );
}

/**
 * Set alignment for all columns.
 */
export function setAllColumnsAlignment(
  view: EditorView,
  info: SourceTableInfo,
  alignment: TableAlignment
): void {
  rewriteSeparatorRow(view, info, (cell) => alignedSeparatorCell(cell, alignment));
}

/**
 * Format table with space-padded columns.
 * Ensures all lines have the same length.
 * Returns true if formatting was applied.
 */
export function formatTable(view: EditorView, info: SourceTableInfo): boolean {
  const doc = view.state.doc;
  const parsedRows = info.lines.map((line) => parseTableRow(line));

  // Body rows may carry MORE cells than the header declares; those cells are
  // data, so the widest row (not info.colCount) sets the column count.
  const colCount = computeColCount(parsedRows, info.colCount);
  const alignments = parseAlignments(parsedRows[1] || [], colCount);
  const colWidths = computeColumnWidths(parsedRows, alignments);
  const formattedLines = renderTableLines(parsedRows, alignments, colWidths);

  const startLine = doc.line(info.startLine + 1);
  const endLine = doc.line(info.endLine + 1);
  const newContent = formattedLines.join("\n");
  const currentContent = doc.sliceString(startLine.from, endLine.to);

  // Only dispatch if content actually changed
  if (newContent === currentContent) {
    return false;
  }

  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert: newContent },
  });

  view.focus();
  return true;
}
