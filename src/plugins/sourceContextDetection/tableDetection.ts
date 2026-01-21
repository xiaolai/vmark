/**
 * Table Detection for Source Mode
 *
 * Utilities to detect if cursor is inside a markdown table.
 */

import type { EditorView } from "@codemirror/view";

/**
 * Table information in source mode.
 */
export interface SourceTableInfo {
  /** Start position (character offset) of the table */
  start: number;
  /** End position (character offset) of the table */
  end: number;
  /** Line number where table starts (0-indexed) */
  startLine: number;
  /** Line number where table ends (0-indexed) */
  endLine: number;
  /** Current row index (0 = header, 1 = separator, 2+ = data) */
  rowIndex: number;
  /** Current column index (0-indexed) */
  colIndex: number;
  /** Total number of columns */
  colCount: number;
  /** All table lines */
  lines: string[];
}

export type TableAlignment = "left" | "center" | "right";

/**
 * Check if a line is part of a markdown table.
 */
function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") || trimmed.includes("|");
}

/**
 * Check if a line is a table separator (|---|---|).
 */
function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  return /^\|[\s|:-]+\|?$/.test(trimmed);
}

/**
 * Parse a table row into cells.
 */
function parseRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * Detect if cursor is inside a markdown table and get table info.
 */
export function getSourceTableInfo(view: EditorView): SourceTableInfo | null {
  const { state } = view;
  const { from } = state.selection.main;
  const doc = state.doc;

  const currentLine = doc.lineAt(from);
  const currentLineText = currentLine.text;

  if (!isTableLine(currentLineText)) {
    return null;
  }

  // Find table boundaries
  let startLine = currentLine.number;
  let endLine = currentLine.number;

  // Scan upward
  for (let i = currentLine.number - 1; i >= 1; i--) {
    const line = doc.line(i);
    if (!isTableLine(line.text)) {
      startLine = i + 1;
      break;
    }
    startLine = i;
  }

  // Scan downward
  const totalLines = doc.lines;
  for (let i = currentLine.number + 1; i <= totalLines; i++) {
    const line = doc.line(i);
    if (!isTableLine(line.text)) {
      endLine = i - 1;
      break;
    }
    endLine = i;
  }

  // Collect all table lines
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(doc.line(i).text);
  }

  // Need at least 2 lines for a valid table
  if (lines.length < 2) {
    return null;
  }

  // Check if second line is separator
  if (!isSeparatorLine(lines[1])) {
    return null;
  }

  // Calculate current row index
  const rowIndex = currentLine.number - startLine;

  // Calculate column index
  const posInLine = from - currentLine.from;
  const beforeCursor = currentLineText.slice(0, posInLine);
  const colIndex =
    (beforeCursor.match(/\|/g) || []).length -
    (beforeCursor.startsWith("|") ? 1 : 0);

  // Get column count from separator line
  const separatorCells = parseRow(lines[1]);
  const colCount = separatorCells.length;

  // Get table start/end positions
  const startPos = doc.line(startLine).from;
  const endPos = doc.line(endLine).to;

  return {
    start: startPos,
    end: endPos,
    startLine: startLine - 1, // Convert to 0-indexed
    endLine: endLine - 1,
    rowIndex,
    colIndex: Math.max(0, Math.min(colIndex, colCount - 1)),
    colCount,
    lines,
  };
}

/**
 * Check if cursor is in table but not in separator row.
 */
export function isInEditableTableRow(info: SourceTableInfo): boolean {
  return info.rowIndex !== 1;
}

// Re-export actions for convenience
export {
  insertRowAbove,
  insertRowBelow,
  insertColumnLeft,
  insertColumnRight,
  deleteRow,
  deleteColumn,
  deleteTable,
  getColumnAlignment,
  setColumnAlignment,
  setAllColumnsAlignment,
  formatTable,
} from "./tableActions";
