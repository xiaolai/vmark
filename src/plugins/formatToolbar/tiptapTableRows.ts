import type { EditorView } from "@tiptap/pm/view";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";
import { alignColumn, addColLeft, addColRight, addRowAbove, addRowBelow, deleteCurrentColumn, deleteCurrentRow, deleteCurrentTable, formatTable } from "@/plugins/tableUI/tableActions.tiptap";
import { createToolbarButton, createToolbarRow, createToolbarSeparator } from "./tiptapToolbarDom";
import { tiptapToolbarIcons } from "./tiptapUi";

function closeToolbar() {
  const store = useFormatToolbarStore.getState();
  store.clearOriginalCursor();
  store.closeToolbar();
}

export function appendTiptapTableRows(container: HTMLElement, view: EditorView) {
  const opsRow = createToolbarRow();
  opsRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.addRowAbove, title: "Insert row above", onClick: () => { addRowAbove(view); closeToolbar(); } }));
  opsRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.addRowBelow, title: "Insert row below", onClick: () => { addRowBelow(view); closeToolbar(); } }));
  opsRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.addColLeft, title: "Insert column left", onClick: () => { addColLeft(view); closeToolbar(); } }));
  opsRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.addColRight, title: "Insert column right", onClick: () => { addColRight(view); closeToolbar(); } }));
  opsRow.appendChild(createToolbarSeparator());
  opsRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.deleteRow, title: "Delete row", onClick: () => { deleteCurrentRow(view); closeToolbar(); } }));
  opsRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.deleteCol, title: "Delete column", onClick: () => { deleteCurrentColumn(view); closeToolbar(); } }));
  opsRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.deleteTable, title: "Delete table", onClick: () => { deleteCurrentTable(view); closeToolbar(); } }));
  container.appendChild(opsRow);

  const alignRow = createToolbarRow();
  alignRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.alignLeft, title: "Align column left", onClick: () => { alignColumn(view, "left", false); closeToolbar(); } }));
  alignRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.alignCenter, title: "Align column center", onClick: () => { alignColumn(view, "center", false); closeToolbar(); } }));
  alignRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.alignRight, title: "Align column right", onClick: () => { alignColumn(view, "right", false); closeToolbar(); } }));
  alignRow.appendChild(createToolbarSeparator());
  alignRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.alignAllLeft, title: "Align all left", onClick: () => { alignColumn(view, "left", true); closeToolbar(); } }));
  alignRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.alignAllCenter, title: "Align all center", onClick: () => { alignColumn(view, "center", true); closeToolbar(); } }));
  alignRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.alignAllRight, title: "Align all right", onClick: () => { alignColumn(view, "right", true); closeToolbar(); } }));
  alignRow.appendChild(createToolbarSeparator());
  alignRow.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.formatTable, title: "Format table", onClick: () => { formatTable(view); closeToolbar(); } }));
  container.appendChild(alignRow);
}

