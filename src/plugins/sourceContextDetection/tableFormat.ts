/**
 * Pure formatting helpers for source-mode markdown tables.
 *
 * Extracted from tableActions.ts so the view-coupled actions stay small and
 * the formatting arithmetic is testable without an EditorView.
 *
 * @coordinates-with sourceContextDetection/tableActions.ts — dispatches these results into the editor
 */

import { getDisplayWidth, padToWidth } from "@/utils/stringWidth";
import { splitTableCells } from "@/utils/tableParser";
import type { SourceTableInfo, TableAlignment } from "./tableTypes";

/**
 * Parse alignment from a separator cell.
 */
export function parseAlignment(cell: string): TableAlignment {
  const trimmed = cell.trim();
  const hasLeft = trimmed.startsWith(":");
  const hasRight = trimmed.endsWith(":");

  if (hasLeft && hasRight) return "center";
  if (hasRight) return "right";
  return "left";
}

/**
 * Format a separator cell with alignment, to the requested total width.
 *
 * `explicitLeft` separates SETTING left alignment (a request, written `:---`)
 * from RE-FORMATTING a table (which must leave an unaligned column alone).
 * `parseAlignment` reports both spellings as "left", so without the flag one
 * caller is always wrong: bare dashes made "align left" do nothing visible,
 * an unconditional colon made "format table" stamp alignment everywhere.
 */
export function formatAlignmentCell(
  alignment: TableAlignment,
  width = 5,
  explicitLeft = false
): string {
  const minDashes = 3;
  const dashes = (pad: number): string => "-".repeat(Math.max(minDashes, width - pad));
  switch (alignment) {
    case "center":
      return `:${dashes(2)}:`;
    case "right":
      return `${dashes(1)}:`;
    default:
      return explicitLeft ? `:${dashes(1)}` : dashes(0);
  }
}

/**
 * Get minimum width for a separator cell based on alignment.
 * center (:---:) = 5, right (---:) = 4, left (---) = 3
 */
export function getMinWidthForAlignment(alignment: TableAlignment): number {
  switch (alignment) {
    case "center":
      return 5;
    case "right":
      return 4;
    default:
      return 3;
  }
}

/**
 * Build empty cells matching the widths of existing table columns.
 * Uses raw (untrimmed) cell content from splitTableCells to match
 * the actual column display widths in a formatted table.
 */
export function buildEmptyCells(info: SourceTableInfo): string[] {
  // Use splitTableCells on raw header to preserve padding widths
  let rawHeader = info.lines[0].trim();
  if (rawHeader.startsWith("|")) rawHeader = rawHeader.slice(1);
  rawHeader = rawHeader.trimEnd();
  if (rawHeader.endsWith("|") && !rawHeader.endsWith("\\|")) rawHeader = rawHeader.slice(0, -1);
  const rawCells = splitTableCells(rawHeader);

  return Array.from({ length: info.colCount }, (_, i) => {
    // A formatted cell carries one wrapper space on each side, and the row
    // renderer (`| ${cells.join(" | ")} |`) adds its own wrappers back, so
    // measure the INNER width — measuring the raw cell would widen the new
    // row by two characters per column.
    const raw = i < rawCells.length ? rawCells[i] : "";
    const inner = raw.replace(/^ /, "").replace(/ $/, "");
    const width = Math.max(3, getDisplayWidth(inner));
    return padToWidth("", width);
  });
}

/**
 * Widest row wins: a body row carrying MORE cells than the header declares
 * is data, and formatting must pad the table out to it, never truncate.
 */
export function computeColCount(parsedRows: string[][], minColCount: number): number {
  return parsedRows.reduce((max, row) => Math.max(max, row.length), minColCount);
}

/**
 * Read per-column alignments from the separator row's cells.
 * Missing cells (colCount beyond the separator) default to "left".
 */
export function parseAlignments(
  separatorCells: string[],
  colCount: number
): TableAlignment[] {
  return Array.from({ length: colCount }, (_, col) =>
    parseAlignment(separatorCells[col] || "")
  );
}

/**
 * Compute each column's target width: the widest content cell in the column,
 * floored at the alignment marker's minimum legal width.
 */
export function computeColumnWidths(
  parsedRows: string[][],
  alignments: TableAlignment[]
): number[] {
  return alignments.map((alignment, col) => {
    let maxWidth = getMinWidthForAlignment(alignment);
    for (let row = 0; row < parsedRows.length; row++) {
      if (row === 1) continue; // Separator width is derived, not measured
      maxWidth = Math.max(maxWidth, getDisplayWidth(parsedRows[row][col] || ""));
    }
    return maxWidth;
  });
}

/**
 * Render parsed rows into width-aligned `| … |` lines. Row 1 is the
 * separator; its cells are rebuilt from the alignments. Every row is padded
 * out to the alignments' length, so extra-cell rows stay intact.
 */
export function renderTableLines(
  parsedRows: string[][],
  alignments: TableAlignment[],
  colWidths: number[]
): string[] {
  return parsedRows.map((cells, row) => {
    const formatted = alignments.map((alignment, col) =>
      row === 1
        ? formatAlignmentCell(alignment, colWidths[col])
        : padToWidth(cells[col] || "", colWidths[col])
    );
    return `| ${formatted.join(" | ")} |`;
  });
}
