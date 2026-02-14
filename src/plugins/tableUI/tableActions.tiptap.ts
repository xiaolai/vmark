/**
 * Table Actions for WYSIWYG Mode
 *
 * Purpose: Provides row/column manipulation commands (add, delete, move, alignment)
 * for ProseMirror tables. These are called from the table context menu and toolbar.
 *
 * Key decisions:
 *   - Uses @tiptap/pm/tables for core add/delete but adds custom move and alignment
 *   - Selection.near workaround because TypeScript doesn't expose the static method
 *   - Alignment is stored per-cell via `textAlign` attribute on table cells
 *
 * @coordinates-with TiptapTableContextMenu.ts — context menu triggers these actions
 * @coordinates-with tiptap.ts — registers the table UI extension
 * @module plugins/tableUI/tableActions.tiptap
 */
import type { EditorView } from "@tiptap/pm/view";
import type { Node, ResolvedPos } from "@tiptap/pm/model";
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow } from "@tiptap/pm/tables";
import type { Selection } from "@tiptap/pm/state";

type SelectionConstructor = {
  near: (pos: ResolvedPos, bias?: number) => Selection;
};

/**
 * Set selection to the nearest valid position.
 * Works around TypeScript not exposing the Selection.near static method.
 */
export function setSelectionNear(
  view: EditorView,
  tr: { doc: { resolve: (pos: number) => ResolvedPos }; setSelection: (sel: Selection) => unknown },
  pos: number
) {
  const selectionCtor = view.state.selection.constructor as unknown as SelectionConstructor;
  tr.setSelection(selectionCtor.near(tr.doc.resolve(pos)));
}

export type TableAlignment = "left" | "center" | "right";

export type TableInfo = {
  tableNode: Node;
  tablePos: number;
  rowIndex: number;
  colIndex: number;
  numRows: number;
  numCols: number;
};

export function isInTable(view: EditorView): boolean {
  const $pos = view.state.selection.$from;
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table") return true;
  }
  return false;
}

export function getTableInfo(view: EditorView): TableInfo | null {
  const $pos = view.state.selection.$from;

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

  if (!tableNode || tablePos < 0 || tableDepth < 0) return null;

  const rowIndex = $pos.depth > tableDepth ? $pos.index(tableDepth) : 0;
  const colIndex = $pos.depth > tableDepth + 1 ? $pos.index(tableDepth + 1) : 0;

  const numRows = tableNode.childCount;
  const numCols = numRows > 0 ? tableNode.child(0).childCount : 0;

  return { tableNode, tablePos, rowIndex, colIndex, numRows, numCols };
}

function getCellPosition(table: Node, tablePos: number, rowIndex: number, colIndex: number): number | null {
  if (rowIndex < 0 || rowIndex >= table.childCount) return null;

  let pos = tablePos + 1;
  for (let r = 0; r < rowIndex; r++) {
    pos += table.child(r).nodeSize;
  }

  const row = table.child(rowIndex);
  if (colIndex < 0 || colIndex >= row.childCount) return null;

  pos += 1;
  for (let c = 0; c < colIndex; c++) {
    pos += row.child(c).nodeSize;
  }

  return pos + 1;
}

export function addRowAbove(view: EditorView): boolean {
  const info = getTableInfo(view);
  if (!info) return false;
  view.focus();
  const cmd = info.rowIndex === 0 ? addRowAfter : addRowBefore;
  return cmd(view.state, view.dispatch);
}

export function addRowBelow(view: EditorView): boolean {
  if (!isInTable(view)) return false;
  view.focus();
  return addRowAfter(view.state, view.dispatch);
}

export function addColLeft(view: EditorView): boolean {
  if (!isInTable(view)) return false;
  view.focus();
  return addColumnBefore(view.state, view.dispatch);
}

export function addColRight(view: EditorView): boolean {
  if (!isInTable(view)) return false;
  view.focus();
  return addColumnAfter(view.state, view.dispatch);
}

export function deleteCurrentRow(view: EditorView): boolean {
  if (!isInTable(view)) return false;
  // If table only has header + 1 data row (2 rows total), delete entire table
  const info = getTableInfo(view);
  if (info && info.numRows <= 2) {
    return deleteCurrentTable(view);
  }
  view.focus();
  return deleteRow(view.state, view.dispatch);
}

export function deleteCurrentColumn(view: EditorView): boolean {
  if (!isInTable(view)) return false;
  view.focus();
  return deleteColumn(view.state, view.dispatch);
}

export function deleteCurrentTable(view: EditorView): boolean {
  const info = getTableInfo(view);
  if (!info) return false;
  view.focus();

  const { state, dispatch } = view;
  const tr = state.tr.delete(info.tablePos, info.tablePos + info.tableNode.nodeSize);
  dispatch(tr);
  return true;
}

export function alignColumn(view: EditorView, alignment: TableAlignment, allColumns: boolean): boolean {
  const info = getTableInfo(view);
  if (!info) return false;

  const { state, dispatch } = view;
  const { tableNode, tablePos, rowIndex, colIndex } = info;

  try {
    const newRows: Node[] = [];
    for (let r = 0; r < tableNode.childCount; r++) {
      const row = tableNode.child(r);
      const newCells: Node[] = [];
      for (let c = 0; c < row.childCount; c++) {
        const cell = row.child(c);
        if (allColumns || c === colIndex) {
          newCells.push(cell.type.create({ ...cell.attrs, alignment }, cell.content, cell.marks));
        } else {
          newCells.push(cell);
        }
      }
      newRows.push(row.type.create(row.attrs, newCells));
    }

    const newTable = tableNode.type.create(tableNode.attrs, newRows);
    const tr = state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable);

    const cursorPos = getCellPosition(newTable, tablePos, rowIndex, colIndex);
    if (cursorPos !== null) {
      setSelectionNear(view, tr, cursorPos);
    }

    dispatch(tr);
    view.focus();
    return true;
  } catch (error) {
    console.error("[tableActions.tiptap] Align failed:", error);
    return false;
  }
}

/**
 * Collect inline content from a cell, flattening multiple paragraphs into one.
 * Preserves marks (bold, italic, links, code, etc.) instead of stripping them.
 */
function collectCellInlineContent(cell: Node, schema: { text: (s: string) => Node }): Node[] {
  const fragments: Node[] = [];

  for (let p = 0; p < cell.childCount; p++) {
    const block = cell.child(p);

    // Add space separator between multiple paragraphs
    if (p > 0 && fragments.length > 0) {
      fragments.push(schema.text(" "));
    }

    // Collect all inline children from this block
    for (let i = 0; i < block.childCount; i++) {
      fragments.push(block.child(i));
    }
  }

  // Trim leading/trailing whitespace-only text nodes
  while (fragments.length > 0) {
    const first = fragments[0];
    if (first.isText && first.text?.trim() === "") {
      fragments.shift();
    } else if (first.isText) {
      const trimmed = first.text!.replace(/^\s+/, "");
      if (trimmed !== first.text) {
        fragments[0] = first.type.schema.text(trimmed, first.marks);
      }
      break;
    } else {
      break;
    }
  }

  while (fragments.length > 0) {
    const last = fragments[fragments.length - 1];
    if (last.isText && last.text?.trim() === "") {
      fragments.pop();
    } else if (last.isText) {
      const trimmed = last.text!.replace(/\s+$/, "");
      if (trimmed !== last.text) {
        fragments[fragments.length - 1] = last.type.schema.text(trimmed, last.marks);
      }
      break;
    } else {
      break;
    }
  }

  return fragments;
}

export function formatTable(view: EditorView): boolean {
  const info = getTableInfo(view);
  if (!info) return false;

  const { state, dispatch } = view;
  const { tableNode, tablePos, rowIndex, colIndex } = info;

  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return false;

  try {
    const newRows: Node[] = [];
    for (let r = 0; r < tableNode.childCount; r++) {
      const row = tableNode.child(r);
      const newCells: Node[] = [];

      for (let c = 0; c < row.childCount; c++) {
        const cell = row.child(c);
        const inlineContent = collectCellInlineContent(cell, state.schema);
        const newParagraph = paragraphType.create(null, inlineContent.length > 0 ? inlineContent : []);
        newCells.push(cell.type.create(cell.attrs, [newParagraph]));
      }

      newRows.push(row.type.create(row.attrs, newCells));
    }

    const newTable = tableNode.type.create(tableNode.attrs, newRows);
    const tr = state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable);

    const cursorPos = getCellPosition(newTable, tablePos, rowIndex, colIndex);
    if (cursorPos !== null) {
      setSelectionNear(view, tr, cursorPos);
    }

    dispatch(tr);
    view.focus();
    return true;
  } catch (error) {
    console.error("[tableActions.tiptap] Format table failed:", error);
    return false;
  }
}
