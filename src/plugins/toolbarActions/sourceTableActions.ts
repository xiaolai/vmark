/**
 * Source Table Actions
 *
 * Table operation handlers for source (CodeMirror) mode.
 * Extracted from sourceAdapter.ts to keep files under ~300 lines.
 *
 * @coordinates-with sourceAdapter.ts — main dispatcher imports these handlers
 * @module plugins/toolbarActions/sourceTableActions
 */

import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { getSourceTableInfo } from "@/plugins/sourceContextDetection/tableDetection";
import {
  deleteColumn,
  deleteRow,
  deleteTable,
  formatTable,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  setAllColumnsAlignment,
  setColumnAlignment,
} from "@/plugins/sourceContextDetection/tableActions";

export function handleTableAction(view: EditorView, action: string): boolean {
  const info = getSourceTableInfo(view);
  if (!info) return false;

  switch (action) {
    case "addRowAbove":
      insertRowAbove(view, info);
      return true;
    case "addRow":
      insertRowBelow(view, info);
      return true;
    case "addColLeft":
      insertColumnLeft(view, info);
      return true;
    case "addCol":
      insertColumnRight(view, info);
      return true;
    case "deleteRow":
      deleteRow(view, info);
      return true;
    case "deleteCol":
      deleteColumn(view, info);
      return true;
    case "deleteTable":
      deleteTable(view, info);
      return true;
    case "alignLeft":
      setColumnAlignment(view, info, "left");
      return true;
    case "alignCenter":
      setColumnAlignment(view, info, "center");
      return true;
    case "alignRight":
      setColumnAlignment(view, info, "right");
      return true;
    case "alignAllLeft":
      setAllColumnsAlignment(view, info, "left");
      return true;
    case "alignAllCenter":
      setAllColumnsAlignment(view, info, "center");
      return true;
    case "alignAllRight":
      setAllColumnsAlignment(view, info, "right");
      return true;
    case "formatTable":
      if (formatTable(view, info)) {
        toast.success("Table formatted");
      }
      return true;
    default:
      return false;
  }
}
