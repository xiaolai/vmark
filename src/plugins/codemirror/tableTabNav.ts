/**
 * Table Tab Navigation for CodeMirror Source Mode
 *
 * Purpose: Provides Tab/Shift-Tab navigation between markdown table cells, plus
 * arrow key and Mod+Enter shortcuts for row insertion — matching WYSIWYG table UX.
 *
 * Key decisions:
 *   - Cell boundaries are parsed from the pipe-separated text, handling escaped pipes and code spans
 *   - Tab at the last cell of the last row inserts a new row below
 *   - Arrow Up/Down at table boundaries escape to adjacent content
 *   - Mod+Enter and Mod+Shift+Enter insert rows below/above respectively
 *
 * @coordinates-with sourceContextDetection/tableDetection.ts — table structure detection
 * @coordinates-with sourceContextDetection/tableActions.ts — row/column insertion
 * @coordinates-with utils/tableParser.ts — splitTableCells for accurate cell boundary parsing
 * @module plugins/codemirror/tableTabNav
 */

import type { EditorView, KeyBinding } from "@codemirror/view";
import { getSourceTableInfo, isInEditableTableRow } from "@/plugins/sourceContextDetection/tableDetection";
import { insertRowBelow, insertRowAbove } from "@/plugins/sourceContextDetection/tableActions";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { splitTableCells } from "@/utils/tableParser";

export interface CellBoundary {
  from: number; // Start of cell content (after leading space)
  to: number; // End of cell content (before trailing space)
}

/**
 * Parse cell boundaries from a table row.
 * Returns positions relative to line start.
 * Uses splitTableCells to correctly handle escaped pipes and code spans.
 *
 * Example: "| A | B | C |" → [{from: 2, to: 3}, {from: 6, to: 7}, {from: 10, to: 11}]
 */
export function getCellBoundaries(lineText: string): CellBoundary[] {
  const cells: CellBoundary[] = [];

  // Handle leading whitespace (indented tables)
  const trimmed = lineText.trimStart();
  const leadingWs = lineText.length - trimmed.length;

  // Strip leading pipe
  let offset = leadingWs;
  let content = trimmed;
  if (content.startsWith("|")) {
    content = content.slice(1);
    offset += 1;
  }

  // Normalize trailing whitespace then strip trailing pipe (only if not escaped)
  content = content.trimEnd();
  if (content.endsWith("|") && !content.endsWith("\\|")) {
    content = content.slice(0, -1);
  }

  const rawCells = splitTableCells(content);

  let pos = offset;
  for (const rawCell of rawCells) {
    const cellStart = pos;
    const cellEnd = pos + rawCell.length;

    // Trim whitespace to find content boundaries
    let contentStart = cellStart;
    let contentEnd = cellEnd;

    while (contentStart < contentEnd && lineText[contentStart] === " ") {
      contentStart++;
    }
    while (contentEnd > contentStart && lineText[contentEnd - 1] === " ") {
      contentEnd--;
    }

    // For empty cells, place cursor in the middle of the cell
    if (contentStart >= contentEnd) {
      const midPoint = Math.floor((cellStart + cellEnd) / 2);
      cells.push({ from: midPoint, to: midPoint });
    } else {
      cells.push({ from: contentStart, to: contentEnd });
    }

    pos = cellEnd + 1; // +1 for the pipe separator
  }

  return cells;
}

/**
 * Navigate to the next cell in a table.
 * Returns true if handled, false to fall through to other keymaps.
 */
export function goToNextCell(view: EditorView): boolean {
  // Bail out with multiple cursors — let CodeMirror handle default behavior
  if (view.state.selection.ranges.length > 1) return false;

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
    // newLineNum > newDoc.lines only if insertRowBelow failed silently (defensive guard)
    /* v8 ignore next -- @preserve reason: newLineNum always valid after insertRowBelow succeeds */
    if (newLineNum <= newDoc.lines) {
      const newLine = newDoc.line(newLineNum);
      const newCells = getCellBoundaries(newLine.text);
      // newCells.length === 0 only if the inserted row has no parseable cells (defensive guard)
      /* v8 ignore next -- @preserve reason: insertRowBelow always produces a row with cells */
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

  /* v8 ignore next 8 -- @preserve reason: safety guard; table detection guarantees target rows have parseable cells, so targetCells is never empty here */
  if (targetCells.length > 0) {
    view.dispatch({
      selection: { anchor: targetLine.from + targetCells[0].from },
      scrollIntoView: true,
    });
    return true;
  }
  /* v8 ignore next -- @preserve reason: unreachable when targetCells is non-empty (see above guard) */
  return false;
}

/**
 * Navigate to the previous cell in a table.
 * Returns true if handled, false to fall through to other keymaps.
 */
export function goToPreviousCell(view: EditorView): boolean {
  // Bail out with multiple cursors — let CodeMirror handle default behavior
  if (view.state.selection.ranges.length > 1) return false;

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
    // cells.length === 0 only if the header row has no parseable cells (defensive guard)
    /* v8 ignore next -- @preserve reason: table detection requires valid cells in the header row */
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

  /* v8 ignore next 9 -- @preserve reason: safety guard; table detection guarantees target rows have parseable cells, so targetCells is never empty here */
  if (targetCells.length > 0) {
    const lastCell = targetCells[targetCells.length - 1];
    view.dispatch({
      selection: { anchor: targetLine.from + lastCell.from },
      scrollIntoView: true,
    });
    return true;
  }
  /* v8 ignore next -- @preserve reason: unreachable when targetCells is non-empty (see above guard) */
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

/**
 * Mod-Enter: insert a new row below current position in a table.
 */
export function tableModEnter(view: EditorView): boolean {
  if (view.state.selection.ranges.length > 1) return false;
  const info = getSourceTableInfo(view);
  if (!info) return false;
  if (!isInEditableTableRow(info)) return false;

  insertRowBelow(view, info);
  return true;
}

/**
 * Mod-Shift-Enter: insert a new row above current position in a table.
 */
export function tableModShiftEnter(view: EditorView): boolean {
  if (view.state.selection.ranges.length > 1) return false;
  const info = getSourceTableInfo(view);
  if (!info) return false;
  if (!isInEditableTableRow(info)) return false;

  insertRowAbove(view, info);
  return true;
}

/**
 * Mod+Enter key handler for inserting row below in table.
 */
export const tableModEnterKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Mod-Enter",
  run: tableModEnter,
});

/**
 * Mod+Shift+Enter key handler for inserting row above in table.
 */
export const tableModShiftEnterKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Mod-Shift-Enter",
  run: tableModShiftEnter,
});
