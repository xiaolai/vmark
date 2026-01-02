/**
 * Table Utility Functions
 *
 * Helper functions for detecting tables and getting table info from editor state.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { AnchorRect } from "@/utils/popupPosition";

export interface TableInfo {
  tableNode: Node;
  tablePos: number;
  tableDepth: number;
  cellNode: Node | null;
  cellPos: number;
  rowIndex: number;
  colIndex: number;
  numRows: number;
  numCols: number;
}

/**
 * Check if the current selection is inside a table.
 */
export function isInTable(view: EditorView): boolean {
  const { selection } = view.state;
  const $pos = selection.$from;

  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table") {
      return true;
    }
  }
  return false;
}

/**
 * Get detailed information about the table containing the cursor.
 */
export function getTableInfo(view: EditorView): TableInfo | null {
  const { selection } = view.state;
  const $pos = selection.$from;

  // Find table in ancestry
  let tableNode: Node | null = null;
  let tablePos = -1;
  let tableDepth = -1;

  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table") {
      tableNode = node;
      tablePos = $pos.before(d);
      tableDepth = d;
      break;
    }
  }

  if (!tableNode || tablePos < 0 || tableDepth < 0) {
    return null;
  }

  // Use depth-based indexing (table structure is fixed):
  // - table at tableDepth
  // - row at tableDepth + 1 → rowIndex = $pos.index(tableDepth)
  // - cell at tableDepth + 2 → colIndex = $pos.index(tableDepth + 1)
  const rowIndex = $pos.depth > tableDepth ? $pos.index(tableDepth) : 0;
  const colIndex = $pos.depth > tableDepth + 1 ? $pos.index(tableDepth + 1) : 0;

  // Get cell info if cursor is deep enough
  let cellNode: Node | null = null;
  let cellPos = -1;
  const cellDepth = tableDepth + 2;
  if ($pos.depth >= cellDepth) {
    cellNode = $pos.node(cellDepth);
    cellPos = $pos.before(cellDepth);
  }

  // Count rows and columns
  const numRows = tableNode.childCount;
  const numCols = numRows > 0 ? tableNode.child(0).childCount : 0;

  return {
    tableNode,
    tablePos,
    tableDepth,
    cellNode,
    cellPos,
    rowIndex,
    colIndex,
    numRows,
    numCols,
  };
}

/**
 * Get the bounding rectangle of a table element for toolbar positioning.
 */
export function getTableRect(view: EditorView, tablePos: number): AnchorRect | null {
  try {
    // Use tablePos + 1 to get inside the table node (tablePos is position before table)
    const domAtPos = view.domAtPos(tablePos + 1);
    let tableEl: Element | null = domAtPos.node instanceof Element
      ? domAtPos.node
      : domAtPos.node.parentElement;

    // Walk up to find the actual table element
    while (tableEl && tableEl.nodeName !== "TABLE") {
      tableEl = tableEl.parentElement;
    }

    if (tableEl) {
      const rect = tableEl.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      };
    }

    // Fallback: try to find table via nodeDOM
    const tableNode = view.state.doc.nodeAt(tablePos);
    if (tableNode) {
      const dom = view.nodeDOM(tablePos);
      if (dom instanceof HTMLTableElement) {
        const rect = dom.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
        };
      }
    }

    // Last resort: use coordsAtPos (returns point, not rect - avoid this)
    const coords = view.coordsAtPos(tablePos);
    return {
      top: coords.top,
      left: coords.left,
      bottom: coords.bottom,
      right: coords.right,
    };
  } catch {
    return null;
  }
}

/**
 * Find the $pos at a specific depth matching a node type name.
 */
export function findParentNodeOfType(
  $pos: ResolvedPos,
  typeName: string
): { node: Node; pos: number; depth: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === typeName) {
      return {
        node,
        pos: $pos.before(d),
        depth: d,
      };
    }
  }
  return null;
}

/**
 * Check if selection is inside a table (state-based version for keymap commands).
 * Unlike isInTable(view), this accepts any object with a selection property.
 */
export function isSelectionInTable(state: { selection: { $from: ResolvedPos } }): boolean {
  const $pos = state.selection.$from;
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table") {
      return true;
    }
  }
  return false;
}

/**
 * Delete the table at the given position.
 * Returns true if deletion succeeded, false otherwise.
 */
export function deleteTableAtPos(
  view: EditorView,
  tablePos: number
): boolean {
  const { state, dispatch } = view;

  try {
    const tableNode = state.doc.nodeAt(tablePos);
    if (tableNode && tableNode.type.name === "table") {
      const tr = state.tr.delete(tablePos, tablePos + tableNode.nodeSize);
      dispatch(tr);
      return true;
    }
  } catch (error) {
    console.error("[table-utils] Delete table failed:", error);
  }

  return false;
}

/**
 * Delete a row at the specified index.
 * Prevents deletion if it would result in a 1x1 table.
 * Returns true if deletion succeeded, false otherwise.
 */
export function deleteRow(view: EditorView): boolean {
  const tableInfo = getTableInfo(view);
  if (!tableInfo) return false;

  const { tableNode, tablePos, rowIndex, numRows, numCols } = tableInfo;

  // Prevent creating 1x1 table: need at least 2 rows OR 2 cols after deletion
  if (numRows <= 1) return false; // Can't delete last row
  if (numRows === 2 && numCols === 1) return false; // Would become 1x1

  const { state, dispatch } = view;

  try {
    // Build new rows array without the deleted row
    const newRows: Node[] = [];
    for (let r = 0; r < tableNode.childCount; r++) {
      if (r !== rowIndex) {
        newRows.push(tableNode.child(r));
      }
    }

    // Create new table
    const newTable = tableNode.type.create(tableNode.attrs, newRows);

    // Replace table
    const tr = state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable);

    // Set cursor to same column in previous row (or next if deleting first)
    const newRowIndex = rowIndex > 0 ? rowIndex - 1 : 0;
    const cursorPos = getCellPosition(newTable, tablePos, newRowIndex, Math.min(tableInfo.colIndex, numCols - 1));
    if (cursorPos !== null) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));
    }

    dispatch(tr);
    return true;
  } catch (error) {
    console.error("[table-utils] Delete row failed:", error);
    return false;
  }
}

/**
 * Delete a column at the specified index.
 * Prevents deletion if it would result in a 1x1 table.
 * Returns true if deletion succeeded, false otherwise.
 */
export function deleteColumn(view: EditorView): boolean {
  const tableInfo = getTableInfo(view);
  if (!tableInfo) return false;

  const { tableNode, tablePos, colIndex, numRows, numCols } = tableInfo;

  // Prevent creating 1x1 table: need at least 2 cols OR 2 rows after deletion
  if (numCols <= 1) return false; // Can't delete last column
  if (numCols === 2 && numRows === 1) return false; // Would become 1x1

  const { state, dispatch } = view;

  try {
    // Build new rows with the column removed
    const newRows: Node[] = [];
    for (let r = 0; r < tableNode.childCount; r++) {
      const row = tableNode.child(r);
      const newCells: Node[] = [];
      for (let c = 0; c < row.childCount; c++) {
        if (c !== colIndex) {
          newCells.push(row.child(c));
        }
      }
      newRows.push(row.type.create(row.attrs, newCells));
    }

    // Create new table
    const newTable = tableNode.type.create(tableNode.attrs, newRows);

    // Replace table
    const tr = state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable);

    // Set cursor to same row in previous column (or next if deleting first)
    const newColIndex = colIndex > 0 ? colIndex - 1 : 0;
    const cursorPos = getCellPosition(newTable, tablePos, tableInfo.rowIndex, newColIndex);
    if (cursorPos !== null) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));
    }

    dispatch(tr);
    return true;
  } catch (error) {
    console.error("[table-utils] Delete column failed:", error);
    return false;
  }
}

/**
 * Get the document position inside a cell at the given row/col.
 */
function getCellPosition(
  table: Node,
  tablePos: number,
  rowIndex: number,
  colIndex: number
): number | null {
  if (rowIndex < 0 || rowIndex >= table.childCount) return null;

  let pos = tablePos + 1; // Inside table

  // Navigate to row
  for (let r = 0; r < rowIndex; r++) {
    pos += table.child(r).nodeSize;
  }

  const row = table.child(rowIndex);
  if (colIndex < 0 || colIndex >= row.childCount) return null;

  pos += 1; // Inside row

  // Navigate to cell
  for (let c = 0; c < colIndex; c++) {
    pos += row.child(c).nodeSize;
  }

  pos += 1; // Inside cell (content position)

  return pos;
}
