/**
 * Table Detection for Source Mode
 *
 * Utilities to detect if cursor is inside a markdown table
 * and perform table operations on raw markdown text.
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
  // Separator line contains only |, -, :, and whitespace
  return /^\|[\s|:-]+\|?$/.test(trimmed);
}

/**
 * Parse a table row into cells.
 */
function parseRow(line: string): string[] {
  let trimmed = line.trim();
  // Remove leading/trailing pipes
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

  // Get current line
  const currentLine = doc.lineAt(from);
  const currentLineText = currentLine.text;

  // Check if current line looks like a table
  if (!isTableLine(currentLineText)) {
    return null;
  }

  // Find table boundaries by scanning up and down
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

  // Need at least 2 lines for a valid table (header + separator)
  if (lines.length < 2) {
    return null;
  }

  // Check if second line is separator
  if (!isSeparatorLine(lines[1])) {
    return null;
  }

  // Calculate current row index (0-indexed, relative to table start)
  const rowIndex = currentLine.number - startLine;

  // Calculate column index based on cursor position within line
  const posInLine = from - currentLine.from;
  const beforeCursor = currentLineText.slice(0, posInLine);
  const colIndex = (beforeCursor.match(/\|/g) || []).length - (beforeCursor.startsWith("|") ? 1 : 0);

  // Get column count from separator line (most reliable)
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
  return info.rowIndex !== 1; // Row 1 is separator
}

/**
 * Insert a new row below current position.
 */
export function insertRowBelow(view: EditorView, info: SourceTableInfo): void {
  const doc = view.state.doc;
  const currentLineNum = info.startLine + 1 + info.rowIndex;
  const currentLine = doc.line(currentLineNum);

  // Create new row with same number of columns
  const cells = Array(info.colCount).fill("     ");
  const newRow = `| ${cells.join(" | ")} |`;

  // Insert after current line
  view.dispatch({
    changes: { from: currentLine.to, insert: `\n${newRow}` },
    selection: { anchor: currentLine.to + 3 }, // Position in first cell
  });

  view.focus();
}

/**
 * Insert a new row above current position.
 * If in header row (row 0), inserts below header instead (GFM constraint).
 */
export function insertRowAbove(view: EditorView, info: SourceTableInfo): void {
  const doc = view.state.doc;

  // Can't insert above header - insert below separator instead
  if (info.rowIndex === 0) {
    const separatorLine = doc.line(info.startLine + 2);
    const cells = Array(info.colCount).fill("     ");
    const newRow = `| ${cells.join(" | ")} |`;
    view.dispatch({
      changes: { from: separatorLine.to, insert: `\n${newRow}` },
      selection: { anchor: separatorLine.to + 3 },
    });
    view.focus();
    return;
  }

  const currentLineNum = info.startLine + 1 + info.rowIndex;
  const currentLine = doc.line(currentLineNum);

  // Create new row with same number of columns
  const cells = Array(info.colCount).fill("     ");
  const newRow = `| ${cells.join(" | ")} |\n`;

  // Insert before current line
  view.dispatch({
    changes: { from: currentLine.from, insert: newRow },
    selection: { anchor: currentLine.from + 2 }, // Position in first cell
  });

  view.focus();
}

/**
 * Insert a new column to the right of current position.
 */
export function insertColumnRight(view: EditorView, info: SourceTableInfo): void {
  const changes: { from: number; to: number; insert: string }[] = [];
  const doc = view.state.doc;

  for (let i = 0; i < info.lines.length; i++) {
    const lineNum = info.startLine + 1 + i;
    const line = doc.line(lineNum);
    const cells = parseRow(info.lines[i]);

    // Insert new cell after current column
    const insertIdx = Math.min(info.colIndex + 1, cells.length);
    cells.splice(insertIdx, 0, i === 1 ? "-----" : "     ");

    const newLine = `| ${cells.join(" | ")} |`;
    changes.push({ from: line.from, to: line.to, insert: newLine });
  }

  view.dispatch({ changes });
  view.focus();
}

/**
 * Insert a new column to the left of current position.
 */
export function insertColumnLeft(view: EditorView, info: SourceTableInfo): void {
  const changes: { from: number; to: number; insert: string }[] = [];
  const doc = view.state.doc;

  for (let i = 0; i < info.lines.length; i++) {
    const lineNum = info.startLine + 1 + i;
    const line = doc.line(lineNum);
    const cells = parseRow(info.lines[i]);

    // Insert new cell before current column
    cells.splice(info.colIndex, 0, i === 1 ? "-----" : "     ");

    const newLine = `| ${cells.join(" | ")} |`;
    changes.push({ from: line.from, to: line.to, insert: newLine });
  }

  view.dispatch({ changes });
  view.focus();
}

/**
 * Delete current row. Cannot delete header or separator rows.
 */
export function deleteRow(view: EditorView, info: SourceTableInfo): void {
  // Can't delete header (row 0) or separator (row 1)
  if (info.rowIndex <= 1) {
    return;
  }

  const doc = view.state.doc;
  const lineNum = info.startLine + 1 + info.rowIndex;
  const line = doc.line(lineNum);

  // Delete the line including newline before it
  const deleteFrom = line.from - 1; // Include preceding newline
  const deleteTo = line.to;

  view.dispatch({
    changes: { from: deleteFrom, to: deleteTo },
  });

  view.focus();
}

/**
 * Delete current column. Cannot delete if only one column remains.
 */
export function deleteColumn(view: EditorView, info: SourceTableInfo): void {
  // Can't delete if only one column
  if (info.colCount <= 1) {
    return;
  }

  const changes: { from: number; to: number; insert: string }[] = [];
  const doc = view.state.doc;

  for (let i = 0; i < info.lines.length; i++) {
    const lineNum = info.startLine + 1 + i;
    const line = doc.line(lineNum);
    const cells = parseRow(info.lines[i]);

    // Remove the column
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

  // Delete from start of first line to end of last line
  // Include trailing newline if present
  let deleteTo = endLine.to;
  if (deleteTo < doc.length && doc.sliceString(deleteTo, deleteTo + 1) === "\n") {
    deleteTo++;
  }

  view.dispatch({
    changes: { from: startLine.from, to: deleteTo },
  });

  view.focus();
}
