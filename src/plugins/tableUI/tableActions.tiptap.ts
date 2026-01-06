import type { EditorView } from "@tiptap/pm/view";
import type { Node, ResolvedPos } from "@tiptap/pm/model";
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow } from "@tiptap/pm/tables";
import type { Selection } from "@tiptap/pm/state";

type SelectionConstructor = {
  near: (pos: ResolvedPos, bias?: number) => Selection;
};

function setSelectionNear(
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
        const trimmed = cell.textContent.trim();
        const textNode = trimmed ? state.schema.text(trimmed) : null;
        const newParagraph = paragraphType.create(null, textNode ? [textNode] : []);
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
