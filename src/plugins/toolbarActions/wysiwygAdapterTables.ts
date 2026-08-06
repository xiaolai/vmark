/**
 * WYSIWYG Adapter - Table Actions
 *
 * Purpose: Table operation dispatch for WYSIWYG mode — insert, row/column
 * add/delete, per-column and whole-table alignment, and table formatting
 * (with success/no-op toast).
 *
 * Key decisions:
 *   - Table insertion is placed AFTER the current block via `blockInsertPos`;
 *     `insertTable` alone splits the paragraph at the caret.
 *   - The inserted table's SHAPE comes from `shared/blockTemplates`, the same
 *     definition the Source adapter renders to markdown, so the two surfaces
 *     cannot describe different tables.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher narrows table action IDs and routes here
 * @coordinates-with tableUI/tableActions.tiptap.ts — underlying table commands
 * @coordinates-with shared/blockTemplates.ts — NEW_TABLE
 * @module plugins/toolbarActions/wysiwygAdapterTables
 */
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import {
  addColLeft,
  addColRight,
  addRowAbove,
  addRowBelow,
  alignColumn,
  deleteCurrentColumn,
  deleteCurrentRow,
  deleteCurrentTable,
  formatTable,
} from "@/plugins/tableUI/tableActions.tiptap";
import { blockInsertPos } from "@/plugins/shared/blockInsertPos";
import { NEW_TABLE } from "@/plugins/shared/blockTemplates";
import type { WysiwygToolbarContext } from "./types";

/** Table-related action IDs handled in WYSIWYG mode. */
type WysiwygTableAction =
  | "insertTable"
  | "insertTableBlock"
  | "addRowAbove"
  | "addRow"
  | "addColLeft"
  | "addCol"
  | "deleteRow"
  | "deleteCol"
  | "deleteTable"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "alignAllLeft"
  | "alignAllCenter"
  | "alignAllRight"
  | "formatTable";

export function performWysiwygTableAction(
  action: WysiwygTableAction,
  context: WysiwygToolbarContext,
): boolean {
  const view = context.view;

  switch (action) {
    case "insertTable":
    case "insertTableBlock":
      if (!context.editor) return false;
      // Placed AFTER the current block, matching alerts and details.
      // `insertTable` alone splits the paragraph at the caret, opening the table
      // in the middle of a sentence.
      context.editor
        .chain()
        .focus()
        .setTextSelection(blockInsertPos(context.editor.state.selection))
        .insertTable({ ...NEW_TABLE })
        .run();
      return true;
    case "addRowAbove":
      return view ? addRowAbove(view) : false;
    case "addRow":
      return view ? addRowBelow(view) : false;
    case "addColLeft":
      return view ? addColLeft(view) : false;
    case "addCol":
      return view ? addColRight(view) : false;
    case "deleteRow":
      return view ? deleteCurrentRow(view) : false;
    case "deleteCol":
      return view ? deleteCurrentColumn(view) : false;
    case "deleteTable":
      return view ? deleteCurrentTable(view) : false;
    case "alignLeft":
      return view ? alignColumn(view, "left", false) : false;
    case "alignCenter":
      return view ? alignColumn(view, "center", false) : false;
    case "alignRight":
      return view ? alignColumn(view, "right", false) : false;
    case "alignAllLeft":
      return view ? alignColumn(view, "left", true) : false;
    case "alignAllCenter":
      return view ? alignColumn(view, "center", true) : false;
    case "alignAllRight":
      return view ? alignColumn(view, "right", true) : false;
    case "formatTable":
      if (!view) return false;
      if (formatTable(view)) {
        toast.success(i18n.t("dialog:toast.tableFormatted"));
      } else {
        toast.info(i18n.t("dialog:toast.tableAlreadyFormatted"));
      }
      return true;
  }
}
