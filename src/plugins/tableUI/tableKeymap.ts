/**
 * Table Keymap
 *
 * Keyboard shortcuts for table navigation and editing.
 */

import { keymap } from "@milkdown/kit/prose/keymap";
import type { Command } from "@milkdown/kit/prose/state";
import { Selection } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import { callCommand } from "@milkdown/kit/utils";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  addRowBeforeCommand,
  addRowAfterCommand,
  deleteSelectedCellsCommand,
} from "@milkdown/kit/preset/gfm";
import { isSelectionInTable } from "./table-utils";

/**
 * Get table cell info at current position.
 */
function getCellInfo(state: { selection: Selection }): {
  tablePos: number;
  tableNode: Node;
  rowIndex: number;
  colIndex: number;
  numRows: number;
  numCols: number;
  cellPos: number;
} | null {
  const { selection } = state;
  const $pos = selection.$from;

  // Find table
  let tableNode: Node | null = null;
  let tablePos = -1;

  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table") {
      tableNode = $pos.node(d);
      tablePos = $pos.before(d);
      break;
    }
  }

  if (!tableNode || tablePos < 0) return null;

  // Find cell position
  let cellPos = -1;
  for (let d = $pos.depth; d > 0; d--) {
    const nodeName = $pos.node(d).type.name;
    if (nodeName === "table_cell" || nodeName === "table_header") {
      cellPos = $pos.before(d);
      break;
    }
  }

  if (cellPos < 0) return null;

  // Calculate row and column indices
  const numRows = tableNode.childCount;
  const numCols = numRows > 0 ? tableNode.child(0).childCount : 0;

  let rowIndex = 0;
  let colIndex = 0;
  let pos = tablePos + 1; // Start after table opening

  outer: for (let r = 0; r < numRows; r++) {
    const row = tableNode.child(r);
    pos += 1; // Row opening

    for (let c = 0; c < row.childCount; c++) {
      if (pos === cellPos) {
        rowIndex = r;
        colIndex = c;
        break outer;
      }
      pos += row.child(c).nodeSize;
    }

    pos += 1; // Row closing
  }

  return { tablePos, tableNode, rowIndex, colIndex, numRows, numCols, cellPos };
}

/**
 * Move to the next cell (Tab).
 * If at the last cell, add a new row and move to its first cell.
 */
const goToNextCell: Command = (state, dispatch) => {
  if (!isSelectionInTable(state)) return false;

  const info = getCellInfo(state);
  if (!info) return false;

  const { tablePos, tableNode, rowIndex, colIndex, numRows, numCols } = info;

  // Calculate next cell position
  let nextRow = rowIndex;
  let nextCol = colIndex + 1;

  if (nextCol >= numCols) {
    nextCol = 0;
    nextRow = rowIndex + 1;
  }

  // If we're past the last row, add a new row
  if (nextRow >= numRows) {
    if (dispatch) {
      // Create a new row with empty cells matching the table structure
      const lastRow = tableNode.child(numRows - 1);
      const newCells: Node[] = [];
      for (let c = 0; c < numCols; c++) {
        const cellType = state.schema.nodes.table_cell;
        const paragraphType = state.schema.nodes.paragraph;
        const newCell = cellType.create(null, paragraphType.create());
        newCells.push(newCell);
      }
      const rowType = lastRow.type;
      const newRow = rowType.create(null, newCells);

      // Insert the new row at the end of the table
      const insertPos = tablePos + tableNode.nodeSize - 1; // Before table closing tag
      let tr = state.tr.insert(insertPos, newRow);

      // Move cursor to first cell of new row
      const newTableNode = tr.doc.nodeAt(tablePos);
      if (newTableNode) {
        const newCellPos = findCellPos(newTableNode, tablePos, numRows, 0);
        if (newCellPos >= 0) {
          const $pos = tr.doc.resolve(newCellPos + 1);
          const selection = Selection.near($pos);
          tr = tr.setSelection(selection);
        }
      }

      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // Find the position of the next cell
  const targetCellPos = findCellPos(tableNode, tablePos, nextRow, nextCol);
  if (targetCellPos < 0) return false;

  if (dispatch) {
    // Move cursor to start of next cell content
    const $pos = state.doc.resolve(targetCellPos + 1);
    const selection = Selection.near($pos);
    dispatch(state.tr.setSelection(selection).scrollIntoView());
  }

  return true;
};

/**
 * Move to the previous cell (Shift+Tab).
 */
const goToPrevCell: Command = (state, dispatch) => {
  if (!isSelectionInTable(state)) return false;

  const info = getCellInfo(state);
  if (!info) return false;

  const { tablePos, tableNode, rowIndex, colIndex, numCols } = info;

  // Calculate previous cell position
  let prevRow = rowIndex;
  let prevCol = colIndex - 1;

  if (prevCol < 0) {
    prevCol = numCols - 1;
    prevRow = rowIndex - 1;
  }

  // If we're before the first row, stay at current position
  if (prevRow < 0) {
    return true; // Handled but don't move
  }

  // Find the position of the previous cell
  const targetCellPos = findCellPos(tableNode, tablePos, prevRow, prevCol);
  if (targetCellPos < 0) return false;

  if (dispatch) {
    // Move cursor to start of previous cell content
    const $pos = state.doc.resolve(targetCellPos + 1);
    const selection = Selection.near($pos);
    dispatch(state.tr.setSelection(selection).scrollIntoView());
  }

  return true;
};

/**
 * Find the document position of a cell.
 */
function findCellPos(
  tableNode: Node,
  tablePos: number,
  rowIndex: number,
  colIndex: number
): number {
  let pos = tablePos + 1; // Start after table opening

  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    pos += 1; // Row opening

    if (r === rowIndex) {
      for (let c = 0; c < row.childCount; c++) {
        if (c === colIndex) {
          return pos;
        }
        pos += row.child(c).nodeSize;
      }
    } else {
      pos += row.nodeSize - 2; // Skip row content (minus opening/closing)
    }

    pos += 1; // Row closing
  }

  return -1;
}

/**
 * Create table keymap commands that use Milkdown context.
 */
export function createTableKeymapCommands(ctx: Ctx) {
  const insertRowBelow: Command = (state, _dispatch, view) => {
    if (!isSelectionInTable(state)) return false;

    if (view) {
      // Use Milkdown command
      try {
        const cmd = callCommand(addRowAfterCommand.key);
        cmd(ctx);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  };

  const insertRowAbove: Command = (state, _dispatch, view) => {
    if (!isSelectionInTable(state)) return false;

    if (view) {
      try {
        const cmd = callCommand(addRowBeforeCommand.key);
        cmd(ctx);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  };

  const deleteRow: Command = (state, _dispatch, view) => {
    if (!isSelectionInTable(state)) return false;

    if (view) {
      try {
        const cmd = callCommand(deleteSelectedCellsCommand.key);
        cmd(ctx);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  };

  // Note: We intentionally don't override Enter - it would conflict with:
  // 1. Slash menu selection
  // 2. Normal paragraph creation within cells
  // Users can use Tab to navigate between cells instead.
  return keymap({
    Tab: goToNextCell,
    "Shift-Tab": goToPrevCell,
    "Mod-Enter": insertRowBelow,
    "Mod-Shift-Enter": insertRowAbove,
    "Mod-Backspace": deleteRow,
  });
}
