/**
 * Table Utility Functions
 *
 * Helper functions for detecting tables and getting table info from editor state.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
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

  if (!tableNode || tablePos < 0) {
    return null;
  }

  // Find current cell
  let cellNode: Node | null = null;
  let cellPos = -1;
  let rowIndex = -1;
  let colIndex = -1;

  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table_cell" || node.type.name === "table_header") {
      cellNode = node;
      cellPos = $pos.before(d);
      break;
    }
  }

  // Calculate row and column indices
  if (cellPos >= 0 && tableDepth > 0) {
    const relativePos = cellPos - tablePos - 1;
    rowIndex = findRowIndex(tableNode, relativePos);
    colIndex = findColIndex(tableNode, rowIndex, relativePos);
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
 * Find the row index for a given position within a table.
 */
function findRowIndex(table: Node, relativePos: number): number {
  let pos = 0;
  for (let row = 0; row < table.childCount; row++) {
    const rowNode = table.child(row);
    const rowSize = rowNode.nodeSize;
    if (pos + rowSize > relativePos) {
      return row;
    }
    pos += rowSize;
  }
  return table.childCount - 1;
}

/**
 * Find the column index for a given position within a row.
 */
function findColIndex(table: Node, rowIndex: number, relativePos: number): number {
  if (rowIndex < 0 || rowIndex >= table.childCount) return 0;

  const row = table.child(rowIndex);
  let rowStart = 0;
  for (let r = 0; r < rowIndex; r++) {
    rowStart += table.child(r).nodeSize;
  }

  const posInRow = relativePos - rowStart - 1; // -1 for row opening tag
  let pos = 0;

  for (let col = 0; col < row.childCount; col++) {
    const cell = row.child(col);
    const cellSize = cell.nodeSize;
    if (pos + cellSize > posInRow) {
      return col;
    }
    pos += cellSize;
  }
  return row.childCount - 1;
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
