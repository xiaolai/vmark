/**
 * Table Cursor Anchoring (Source Mode)
 *
 * Purpose: Map cursor position in a markdown table row to (row, col, offsetInCell)
 * coordinates and back. This enables precise cursor restoration across mode switches
 * for tables, where character offsets are unreliable due to pipe separators and padding.
 *
 * Key decisions:
 *   - Cell ranges account for escaped pipes (\\|) inside cells
 *   - Leading/trailing pipe handling follows GFM conventions
 *   - Row index is relative to the table header (row 0 = header row)
 *
 * @coordinates-with cursorSync/tiptapAnchors.ts — the WYSIWYG counterpart
 * @module utils/cursorSync/table
 */

import type { BlockAnchor } from "@/types/cursorSync";

function isTableSeparatorLine(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableRowLine(line: string): boolean {
  return /\|/.test(line);
}

function findTableHeaderLineIndex(lines: string[], lineIndex: number): number | null {
  if (lineIndex + 1 < lines.length) {
    if (isTableRowLine(lines[lineIndex]) && isTableSeparatorLine(lines[lineIndex + 1])) {
      return lineIndex;
    }
  }

  if (lineIndex - 1 >= 0 && isTableSeparatorLine(lines[lineIndex - 1])) {
    if (lineIndex - 2 >= 0 && isTableRowLine(lines[lineIndex - 2])) {
      return lineIndex - 2;
    }
  }

  if (isTableSeparatorLine(lines[lineIndex]) && lineIndex - 1 >= 0) {
    if (isTableRowLine(lines[lineIndex - 1])) {
      return lineIndex - 1;
    }
  }

  return null;
}

interface TableCellRange {
  rawStart: number;
  rawEnd: number;
  contentStart: number;
  contentEnd: number;
}

function getTableCellRanges(lineText: string): TableCellRange[] {
  const separators: number[] = [];
  for (let i = 0; i < lineText.length; i += 1) {
    const ch = lineText[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "|") {
      separators.push(i);
    }
  }

  if (separators.length === 0) return [];

  const lineEnd = lineText.length;
  const trimmedRight = lineText.replace(/\s+$/, "");
  const hasLeadingPipe = lineText.slice(0, separators[0]).trim().length === 0;
  const hasTrailingPipe =
    separators[separators.length - 1] === Math.max(0, trimmedRight.length - 1);

  const ranges: TableCellRange[] = [];
  let cellStart = hasLeadingPipe ? separators[0] + 1 : 0;
  const startIndex = hasLeadingPipe ? 1 : 0;

  for (let i = startIndex; i < separators.length; i += 1) {
    const sepIndex = separators[i];
    const rawStart = cellStart;
    const rawEnd = sepIndex;
    const contentStart = skipWhitespaceForward(lineText, rawStart, rawEnd);
    const contentEnd = skipWhitespaceBackward(lineText, rawEnd, rawStart);
    ranges.push({ rawStart, rawEnd, contentStart, contentEnd });
    cellStart = sepIndex + 1;
  }

  if (!hasTrailingPipe && cellStart <= lineEnd) {
    const rawStart = cellStart;
    const rawEnd = lineEnd;
    const contentStart = skipWhitespaceForward(lineText, rawStart, rawEnd);
    const contentEnd = skipWhitespaceBackward(lineText, rawEnd, rawStart);
    ranges.push({ rawStart, rawEnd, contentStart, contentEnd });
  }

  return ranges;
}

function skipWhitespaceForward(text: string, start: number, end: number): number {
  let idx = start;
  while (idx < end && text[idx] === " ") idx += 1;
  return idx;
}

function skipWhitespaceBackward(text: string, end: number, start: number): number {
  let idx = end;
  while (idx > start && text[idx - 1] === " ") idx -= 1;
  return idx;
}

export function getTableAnchorForLine(
  lines: string[],
  lineIndex: number,
  columnInLine: number
): BlockAnchor | undefined {
  const headerLine = findTableHeaderLineIndex(lines, lineIndex);
  if (headerLine === null) return undefined;
  if (isTableSeparatorLine(lines[lineIndex])) return undefined;

  const row =
    lineIndex === headerLine ? 0 : Math.max(0, lineIndex - (headerLine + 1));

  const cellRanges = getTableCellRanges(lines[lineIndex]);
  if (cellRanges.length === 0) return undefined;

  let col = cellRanges.findIndex(
    (range) => columnInLine >= range.rawStart && columnInLine <= range.rawEnd
  );
  if (col === -1) {
    col = columnInLine < cellRanges[0].rawStart ? 0 : cellRanges.length - 1;
  }

  const cell = cellRanges[col];
  const maxOffset = Math.max(0, cell.contentEnd - cell.contentStart);
  const offsetInCell = clamp(columnInLine - cell.contentStart, 0, maxOffset);

  return {
    kind: "table",
    row,
    col,
    offsetInCell,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Restore cursor position in a markdown table line using block anchor.
 * Returns the column position, or null if restoration failed.
 */
export function restoreTableColumnFromAnchor(
  lineText: string,
  anchor: { col: number; offsetInCell: number }
): number | null {
  const cellRanges = getTableCellRanges(lineText);
  if (cellRanges.length === 0) return null;

  // Clamp column to valid range
  const col = clamp(anchor.col, 0, cellRanges.length - 1);
  const cell = cellRanges[col];

  // Calculate position: content start + offset (clamped)
  const maxOffset = Math.max(0, cell.contentEnd - cell.contentStart);
  const offset = clamp(anchor.offsetInCell, 0, maxOffset);

  return cell.contentStart + offset;
}
