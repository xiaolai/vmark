/**
 * Format Toolbar Merged Mode Builders
 *
 * Builds node-specific toolbar rows for table, list, and blockquote contexts.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import type { Ctx } from "@milkdown/kit/ctx";
import { icons } from "./formatToolbarIcons";
import { buildActionButton, buildDivider, FORMAT_BUTTONS, buildFormatButton } from "./formatToolbarDom";
import { useFormatToolbarStore, type NodeContext } from "@/stores/formatToolbarStore";
import {
  handleAddRowAbove,
  handleAddRowBelow,
  handleAddColLeft,
  handleAddColRight,
  handleDeleteRow,
  handleDeleteCol,
  handleDeleteTable,
  handleAlignColumn,
  handleFormatTable,
  handleListIndent,
  handleListOutdent,
  handleToBulletList,
  handleToOrderedList,
  handleToggleTaskList,
  handleRemoveList,
  handleBlockquoteNest,
  handleBlockquoteUnnest,
  handleRemoveBlockquote,
} from "./nodeActions";

type EditorGetter = () => { action: (fn: (ctx: Ctx) => void) => void } | undefined;

/**
 * Build merged toolbar with format row + node-specific rows.
 */
export function buildMergedToolbar(
  container: HTMLElement,
  nodeContext: NodeContext,
  editorView: EditorView,
  getEditor: EditorGetter,
  onFormat: (markType: string) => void
): void {
  if (!nodeContext) return;

  // Row 1: Format buttons (always present)
  const formatRow = document.createElement("div");
  formatRow.className = "format-toolbar-row";
  for (const btn of FORMAT_BUTTONS) {
    formatRow.appendChild(buildFormatButton(btn.icon, btn.title, btn.markType, onFormat));
  }
  container.appendChild(formatRow);

  // Node-specific rows
  if (nodeContext.type === "table") {
    buildTableRows(container, editorView, getEditor);
  } else if (nodeContext.type === "list") {
    buildListRow(container, nodeContext, editorView, getEditor);
  } else if (nodeContext.type === "blockquote") {
    buildBlockquoteRow(container, editorView);
  }
}

/**
 * Build table-specific rows (row/col operations + alignment).
 */
function buildTableRows(
  container: HTMLElement,
  editorView: EditorView,
  getEditor: EditorGetter
): void {
  // Row 2: Add/Delete operations (including delete table)
  const row2 = document.createElement("div");
  row2.className = "format-toolbar-row";

  row2.appendChild(buildActionButton(icons.addRowAbove, "Insert row above", () => {
    handleAddRowAbove(editorView, getEditor);
  }));
  row2.appendChild(buildActionButton(icons.addRowBelow, "Insert row below", () => {
    handleAddRowBelow(editorView, getEditor);
  }));
  row2.appendChild(buildActionButton(icons.addColLeft, "Insert column left", () => {
    handleAddColLeft(editorView, getEditor);
  }));
  row2.appendChild(buildActionButton(icons.addColRight, "Insert column right", () => {
    handleAddColRight(editorView, getEditor);
  }));
  row2.appendChild(buildDivider());
  row2.appendChild(buildActionButton(icons.deleteRow, "Delete row", () => {
    handleDeleteRow(editorView);
  }, "danger"));
  row2.appendChild(buildActionButton(icons.deleteCol, "Delete column", () => {
    handleDeleteCol(editorView);
  }, "danger"));
  row2.appendChild(buildActionButton(icons.deleteTable, "Delete table", () => {
    const store = useFormatToolbarStore.getState();
    if (handleDeleteTable(editorView, store.nodeContext)) {
      store.closeToolbar();
    }
  }, "danger"));

  container.appendChild(row2);

  // Row 3: Alignment (column + all) + Format
  const row3 = document.createElement("div");
  row3.className = "format-toolbar-row";

  row3.appendChild(buildActionButton(icons.alignLeft, "Align column left", () => {
    handleAlignColumn(editorView, getEditor, "left", false);
  }));
  row3.appendChild(buildActionButton(icons.alignCenter, "Align column center", () => {
    handleAlignColumn(editorView, getEditor, "center", false);
  }));
  row3.appendChild(buildActionButton(icons.alignRight, "Align column right", () => {
    handleAlignColumn(editorView, getEditor, "right", false);
  }));
  row3.appendChild(buildDivider());
  row3.appendChild(buildActionButton(icons.alignAllLeft, "Align all left", () => {
    handleAlignColumn(editorView, getEditor, "left", true);
  }));
  row3.appendChild(buildActionButton(icons.alignAllCenter, "Align all center", () => {
    handleAlignColumn(editorView, getEditor, "center", true);
  }));
  row3.appendChild(buildActionButton(icons.alignAllRight, "Align all right", () => {
    handleAlignColumn(editorView, getEditor, "right", true);
  }));
  row3.appendChild(buildDivider());
  row3.appendChild(buildActionButton(icons.formatTable, "Format table", () => {
    handleFormatTable(editorView);
  }));

  container.appendChild(row3);
}

/**
 * Build list-specific row.
 */
function buildListRow(
  container: HTMLElement,
  nodeContext: NodeContext,
  editorView: EditorView,
  getEditor: EditorGetter
): void {
  if (nodeContext?.type !== "list") return;

  const row = document.createElement("div");
  row.className = "format-toolbar-row";

  row.appendChild(buildActionButton(icons.outdent, "Outdent", () => {
    handleListOutdent(editorView, getEditor);
  }));
  row.appendChild(buildActionButton(icons.indent, "Indent", () => {
    handleListIndent(editorView, getEditor);
  }));
  row.appendChild(buildDivider());

  // List type buttons with active state
  const bulletBtn = buildActionButton(icons.bulletList, "Bullet list", () => {
    handleToBulletList(editorView, getEditor);
  });
  if (nodeContext.listType === "bullet") bulletBtn.classList.add("active");
  row.appendChild(bulletBtn);

  const orderedBtn = buildActionButton(icons.orderedListIcon, "Ordered list", () => {
    handleToOrderedList(editorView, getEditor);
  });
  if (nodeContext.listType === "ordered") orderedBtn.classList.add("active");
  row.appendChild(orderedBtn);

  const taskBtn = buildActionButton(icons.taskList, "Task list", () => {
    handleToggleTaskList(editorView);
  });
  if (nodeContext.listType === "task") taskBtn.classList.add("active");
  row.appendChild(taskBtn);

  row.appendChild(buildDivider());
  row.appendChild(buildActionButton(icons.removeList, "Remove list", () => {
    handleRemoveList(editorView, getEditor);
    useFormatToolbarStore.getState().closeToolbar();
  }, "danger"));

  container.appendChild(row);
}

/**
 * Build blockquote-specific row.
 */
function buildBlockquoteRow(container: HTMLElement, editorView: EditorView): void {
  const row = document.createElement("div");
  row.className = "format-toolbar-row";

  row.appendChild(buildActionButton(icons.nestQuote, "Nest deeper", () => {
    handleBlockquoteNest(editorView);
  }));
  row.appendChild(buildActionButton(icons.unnestQuote, "Unnest", () => {
    handleBlockquoteUnnest(editorView);
  }));
  row.appendChild(buildDivider());
  row.appendChild(buildActionButton(icons.removeQuote, "Remove quote", () => {
    handleRemoveBlockquote(editorView);
    useFormatToolbarStore.getState().closeToolbar();
  }, "danger"));

  container.appendChild(row);
}
