/**
 * Source Mode Table Cell Highlight
 *
 * CodeMirror 6 plugin that highlights the current table cell
 * when cursor is inside a markdown table.
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

/**
 * Get the character range of the current cell within the table row.
 */
function getCellRange(
  lineText: string,
  lineFrom: number,
  colIndex: number
): { from: number; to: number } | null {
  let inCell = false;
  let currentCol = -1;
  let cellStart = lineFrom;
  let cellEnd = lineFrom + lineText.length;

  for (let i = 0; i < lineText.length; i++) {
    const char = lineText[i];

    if (char === "|") {
      if (inCell) {
        // End of current cell
        if (currentCol === colIndex) {
          cellEnd = lineFrom + i;
          return { from: cellStart, to: cellEnd };
        }
      }
      // Start of next cell
      inCell = true;
      currentCol++;
      cellStart = lineFrom + i + 1;
    }
  }

  // Handle last cell (if no trailing |)
  if (inCell && currentCol === colIndex) {
    return { from: cellStart, to: lineFrom + lineText.length };
  }

  return null;
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
