/**
 * Table Tab Navigation for CodeMirror Source Mode
 *
 * Provides Tab/Shift-Tab navigation between table cells, matching WYSIWYG behavior.
 * Per spec in docs/cursor-context-system.md (Table Keyboard Navigation).
 */

import type { EditorView, KeyBinding } from "@codemirror/view";
import { getSourceTableInfo, isInEditableTableRow } from "@/plugins/sourceContextDetection/tableDetection";
import { insertRowBelow } from "@/plugins/sourceContextDetection/tableActions";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";

export interface CellBoundary {
  from: number; // Start of cell content (after leading space)
  to: number; // End of cell content (before trailing space)
}

/**
 * Parse cell boundaries from a table row.
 * Returns positions relative to line start.
 *
 * Example: "| A | B | C |" → [{from: 2, to: 3}, {from: 6, to: 7}, {from: 10, to: 11}]
 */
export function getCellBoundaries(lineText: string): CellBoundary[] {
  const cells: CellBoundary[] = [];
  let pos = 0;

  // Skip leading pipe if present
  if (lineText.startsWith("|")) {
    pos = 1;
  }

  while (pos < lineText.length) {
    const cellStart = pos;

    // Find next pipe or end
    while (pos < lineText.length && lineText[pos] !== "|") {
      pos++;
    }

    // We found a cell (from cellStart to pos)
    // Trim whitespace to find content boundaries
    let contentStart = cellStart;
    let contentEnd = pos;

    // Skip leading whitespace
    while (contentStart < contentEnd && lineText[contentStart] === " ") {
      contentStart++;
    }

    // Skip trailing whitespace
    while (contentEnd > contentStart && lineText[contentEnd - 1] === " ") {
      contentEnd--;
    }

    // For empty cells, place cursor in the middle of the cell
    if (contentStart >= contentEnd) {
      const midPoint = Math.floor((cellStart + pos) / 2);
      cells.push({ from: midPoint, to: midPoint });
    } else {
      cells.push({ from: contentStart, to: contentEnd });
    }

    // Skip the pipe
    if (pos < lineText.length && lineText[pos] === "|") {
      pos++;
    }

    // Stop if we've reached the end or trailing pipe
    if (pos >= lineText.length) {
      break;
    }
  }

  return cells;
}

/**
 * Navigate to the next cell in a table.
 * Returns true if handled, false to fall through to other keymaps.
 */
export function goToNextCell(view: EditorView): boolean {
  const info = getSourceTableInfo(view);
  if (!info) return false;

  // Can't navigate from separator row
  if (!isInEditableTableRow(info)) return false;

  const doc = view.state.doc;
  const currentLineNum = info.startLine + 1 + info.rowIndex;
  const currentLine = doc.line(currentLineNum);
  const cells = getCellBoundaries(currentLine.text);

  // Determine next cell position
  const nextCol = info.colIndex + 1;

  if (nextCol < cells.length) {
    // Move to next cell in same row
    const cell = cells[nextCol];
    view.dispatch({
      selection: { anchor: currentLine.from + cell.from },
      scrollIntoView: true,
    });
    return true;
  }

  // At last column - need to go to next row
  const nextRowIndex = info.rowIndex + 1;

  // Skip separator row (index 1)
  const targetRowIndex = nextRowIndex === 1 ? 2 : nextRowIndex;

  // Check if we're at the last row
  const totalRows = info.lines.length;
  if (targetRowIndex >= totalRows) {
    // At last cell of last row - insert new row
    insertRowBelow(view, info);

    // After insert, move to first cell of new row
    // The new row is now at targetRowIndex
    const newDoc = view.state.doc;
    const newLineNum = info.startLine + 1 + targetRowIndex;
    if (newLineNum <= newDoc.lines) {
      const newLine = newDoc.line(newLineNum);
      const newCells = getCellBoundaries(newLine.text);
      if (newCells.length > 0) {
        view.dispatch({
          selection: { anchor: newLine.from + newCells[0].from },
          scrollIntoView: true,
        });
      }
    }
    return true;
  }

  // Move to first cell of target row
  const targetLineNum = info.startLine + 1 + targetRowIndex;
  const targetLine = doc.line(targetLineNum);
  const targetCells = getCellBoundaries(targetLine.text);

  if (targetCells.length > 0) {
    view.dispatch({
      selection: { anchor: targetLine.from + targetCells[0].from },
      scrollIntoView: true,
    });
    return true;
  }

  return false;
}

/**
 * Navigate to the previous cell in a table.
 * Returns true if handled, false to fall through to other keymaps.
 */
export function goToPreviousCell(view: EditorView): boolean {
  const info = getSourceTableInfo(view);
  if (!info) return false;

  // Can't navigate from separator row
  if (!isInEditableTableRow(info)) return false;

  const doc = view.state.doc;
  const currentLineNum = info.startLine + 1 + info.rowIndex;
  const currentLine = doc.line(currentLineNum);
  const cells = getCellBoundaries(currentLine.text);

  // Determine previous cell position
  const prevCol = info.colIndex - 1;

  if (prevCol >= 0) {
    // Move to previous cell in same row
    const cell = cells[prevCol];
    view.dispatch({
      selection: { anchor: currentLine.from + cell.from },
      scrollIntoView: true,
    });
    return true;
  }

  // At first column - need to go to previous row
  let prevRowIndex = info.rowIndex - 1;

  // Skip separator row (index 1)
  if (prevRowIndex === 1) {
    prevRowIndex = 0; // Go to header row
  }

  if (prevRowIndex < 0) {
    // Already at first cell of header - stay put
    if (cells.length > 0) {
      view.dispatch({
        selection: { anchor: currentLine.from + cells[0].from },
        scrollIntoView: true,
      });
    }
    return true;
  }

  // Move to last cell of previous row
  const targetLineNum = info.startLine + 1 + prevRowIndex;
  const targetLine = doc.line(targetLineNum);
  const targetCells = getCellBoundaries(targetLine.text);

  if (targetCells.length > 0) {
    const lastCell = targetCells[targetCells.length - 1];
    view.dispatch({
      selection: { anchor: targetLine.from + lastCell.from },
      scrollIntoView: true,
    });
    return true;
  }

  return false;
}

/**
 * Tab key handler for table cell navigation.
 * Must be placed before tabEscapeKeymap in keymap order.
 */
export const tableTabKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Tab",
  run: goToNextCell,
});

/**
 * Shift+Tab key handler for table cell navigation.
 */
export const tableShiftTabKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Shift-Tab",
  run: goToPreviousCell,
});

/**
 * Check if table is the first block in the document.
 */
export function isSourceTableFirstBlock(tableStart: number): boolean {
  return tableStart === 0;
}

/**
 * Check if table is the last block in the document.
 */
export function isSourceTableLastBlock(tableEnd: number, docLength: number): boolean {
  return tableEnd === docLength;
}

/**
 * Handle ArrowUp when cursor is in the first row of a table.
 * If table is the first block, insert a paragraph before it.
 * @returns true if handled, false to let default behavior proceed
 */
export function escapeTableUp(view: EditorView): boolean {
  const info = getSourceTableInfo(view);
  if (!info) return false;

  // Only handle when in first row (header)
  if (info.rowIndex !== 0) return false;

  // Only handle when table is first block
  if (!isSourceTableFirstBlock(info.start)) return false;

  // Insert newline before table
  view.dispatch({
    changes: { from: 0, to: 0, insert: "\n" },
    selection: { anchor: 0 },
    scrollIntoView: true,
  });

  return true;
}

/**
 * Handle ArrowDown when cursor is in the last row of a table.
 * If table is the last block, insert a paragraph after it.
 * @returns true if handled, false to let default behavior proceed
 */
export function escapeTableDown(view: EditorView): boolean {
  const info = getSourceTableInfo(view);
  if (!info) return false;

  // Only handle when in last row
  if (info.rowIndex !== info.lines.length - 1) return false;

  // Only handle when table is last block
  const docLength = view.state.doc.length;
  if (!isSourceTableLastBlock(info.end, docLength)) return false;

  // Insert newline after table
  view.dispatch({
    changes: { from: info.end, to: info.end, insert: "\n" },
    selection: { anchor: info.end + 1 },
    scrollIntoView: true,
  });

  return true;
}

/**
 * ArrowUp key handler for table escape.
 * At first row of first-block table, inserts paragraph before.
 */
export const tableArrowUpKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "ArrowUp",
  run: escapeTableUp,
});

/**
 * ArrowDown key handler for table escape.
 * At last row of last-block table, inserts paragraph after.
 */
export const tableArrowDownKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "ArrowDown",
  run: escapeTableDown,
});
