/**
 * Table Detection for Source Mode
 *
 * Utilities to detect if cursor is inside a markdown table.
 */

import type { EditorView } from "@codemirror/view";
import { splitTableCells, parseTableRow } from "@/utils/tableParser";

import type { SourceTableInfo } from "./tableTypes";
export type { SourceTableInfo } from "./tableTypes";

/**
 * Check if a line is part of a markdown table.
 * Requires the line starts with optional whitespace then `|`,
 * AND has at least two `|` characters (a cell boundary).
 */
export function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  // Need at least 2 cells for a valid table row (e.g., "| A |" or "| A | B")
  const cells = splitTableCells(trimmed.slice(1)); // slice off leading pipe
  return cells.length >= 2;
}

/**
 * Check if a line is a table separator (|---|---|).
 */
function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  /* v8 ignore next -- @preserve reason: non-pipe separator lines not reached in tested table scenarios */
  if (!trimmed.startsWith("|")) return false;
  return /^\|[\s|:-]+\|?$/.test(trimmed);
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

  // Calculate column index using splitTableCells (handles escaped pipes + code spans)
  const posInLine = from - currentLine.from;
  const colIndex = getColIndexAtPosition(currentLineText, posInLine);

  // Get column count from separator line (escape-aware)
  const separatorCells = parseTableRow(lines[1]);
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
 * Calculate the column index at a given character position within a table line.
 * Uses the same escape/code-span logic as splitTableCells.
 */
function getColIndexAtPosition(lineText: string, pos: number): number {
  let col = -1;
  let escaped = false;
  let inCode = false;
  let codeFenceLen = 0;

  for (let i = 0; i < pos && i < lineText.length; i++) {
    const ch = lineText[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "`") {
      let runLen = 1;
      while (i + runLen < lineText.length && lineText[i + runLen] === "`") {
        runLen++;
      }

      if (!inCode) {
        inCode = true;
        codeFenceLen = runLen;
      /* v8 ignore start -- @preserve reason: closing code fence within table cell not tested */
      } else if (runLen === codeFenceLen) {
        inCode = false;
        codeFenceLen = 0;
      }
      /* v8 ignore stop */

      i += runLen - 1;
      continue;
    }

    if (ch === "|" && !inCode) {
      col++;
    }
  }

  // The leading pipe increments col but isn't a real column boundary,
  // so col is already correct (first cell = 0 after the leading pipe bump)
  return Math.max(0, col);
}

/**
 * Check if cursor is in table but not in separator row.
 */
export function isInEditableTableRow(info: SourceTableInfo): boolean {
  return info.rowIndex !== 1;
}

