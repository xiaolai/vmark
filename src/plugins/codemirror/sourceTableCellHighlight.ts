/**
 * Source Mode Table Cell Highlight
 *
 * Purpose: Highlights the current table cell with a background decoration when the
 * cursor is inside a markdown table, providing visual feedback for cell navigation.
 *
 * @coordinates-with sourceContextDetection/tableDetection.ts — detects table structure and cursor position
 * @coordinates-with tableTabNav.ts — Tab/Shift-Tab navigation between cells
 * @module plugins/codemirror/sourceTableCellHighlight
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { getSourceTableInfo } from "@/plugins/sourceContextDetection/tableDetection";
import { splitTableCells } from "@/utils/tableParser";

/**
 * Get the character range of the current cell within the table row.
 * Uses splitTableCells to correctly handle escaped pipes and code spans.
 */
function getCellRange(
  lineText: string,
  lineFrom: number,
  colIndex: number
): { from: number; to: number } | null {
  // Split on unescaped pipes to find cell boundaries
  const trimmed = lineText.trimStart();
  const leadingWs = lineText.length - trimmed.length;

  // Remove leading pipe
  let content = trimmed;
  let offset = leadingWs;
  if (content.startsWith("|")) {
    content = content.slice(1);
    offset += 1;
  }

  // Normalize trailing whitespace then strip trailing pipe
  content = content.trimEnd();
  if (content.endsWith("|") && !content.endsWith("\\|")) {
    content = content.slice(0, -1);
  }

  const cells = splitTableCells(content);

  // Target the colIndex-th cell
  if (colIndex < 0 || colIndex >= cells.length) return null;

  // Calculate position by summing up preceding cell lengths + pipe chars
  let pos = offset;
  for (let i = 0; i < colIndex; i++) {
    pos += cells[i].length + 1; // +1 for the pipe separator
  }

  const cellText = cells[colIndex];
  return { from: lineFrom + pos, to: lineFrom + pos + cellText.length };
}

/**
 * Calculate cell highlight decoration.
 */
function getCellHighlightDecoration(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const info = getSourceTableInfo(view);

  if (!info) {
    return builder.finish();
  }

  // Don't highlight the separator row
  if (info.rowIndex === 1) {
    return builder.finish();
  }

  const doc = view.state.doc;
  const currentLineNum = info.startLine + 1 + info.rowIndex;
  const currentLine = doc.line(currentLineNum);

  const cellRange = getCellRange(currentLine.text, currentLine.from, info.colIndex);

  if (cellRange && cellRange.from < cellRange.to) {
    const mark = Decoration.mark({ class: "table-cell-highlight" });
    builder.add(cellRange.from, cellRange.to, mark);
  }

  return builder.finish();
}

/**
 * Creates the source table cell highlight plugin.
 */
export function createSourceTableCellHighlightPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = getCellHighlightDecoration(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = getCellHighlightDecoration(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * All extensions for source table cell highlight.
 */
export const sourceTableCellHighlightExtensions = [createSourceTableCellHighlightPlugin()];
