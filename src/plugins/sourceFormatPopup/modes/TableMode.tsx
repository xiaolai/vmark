/**
 * Table Mode Component
 *
 * Renders table editing buttons for row/column operations and alignment.
 */

import type { EditorView } from "@codemirror/view";
import { icons, createIcon } from "@/utils/icons";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import {
  insertRowAbove,
  insertRowBelow,
  insertColumnLeft,
  insertColumnRight,
  deleteRow,
  deleteColumn,
  deleteTable,
  setColumnAlignment,
  setAllColumnsAlignment,
  getColumnAlignment,
  formatTable,
  type SourceTableInfo,
  type TableAlignment,
} from "../tableDetection";
import {
  TABLE_BUTTONS,
  ALIGN_BUTTONS,
  ALIGN_ALL_BUTTONS,
  type TableButtonDef,
} from "../buttonDefs";

interface TableModeProps {
  editorView: EditorView;
  tableInfo: SourceTableInfo;
}

export function TableMode({ editorView, tableInfo }: TableModeProps) {
  const handleTableAction = (action: TableButtonDef["action"]) => {
    switch (action) {
      case "rowAbove":
        insertRowAbove(editorView, tableInfo);
        break;
      case "rowBelow":
        insertRowBelow(editorView, tableInfo);
        break;
      case "colLeft":
        insertColumnLeft(editorView, tableInfo);
        break;
      case "colRight":
        insertColumnRight(editorView, tableInfo);
        break;
      case "deleteRow":
        deleteRow(editorView, tableInfo);
        break;
      case "deleteCol":
        deleteColumn(editorView, tableInfo);
        break;
      case "deleteTable": {
        deleteTable(editorView, tableInfo);
        const store = useSourceFormatStore.getState();
        store.clearOriginalCursor();
        store.closePopup();
        break;
      }
    }
  };

  const handleAlignment = (alignment: TableAlignment) => {
    setColumnAlignment(editorView, tableInfo, alignment);
  };

  const handleAlignAll = (alignment: TableAlignment) => {
    setAllColumnsAlignment(editorView, tableInfo, alignment);
  };

  const handleFormatTable = () => {
    formatTable(editorView, tableInfo);
  };

  return (
    <div className="source-format-table-grid">
      <div className="source-format-row">
        {TABLE_BUTTONS.map(({ id, icon, label, action }) =>
          action === "separator" ? (
            <div key={id} className="source-format-separator" />
          ) : (
            <button
              key={id}
              type="button"
              className="source-format-btn"
              title={label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleTableAction(action)}
            >
              {icon}
            </button>
          )
        )}
      </div>
      <div className="source-format-row">
        {ALIGN_BUTTONS.map(({ id, icon, label, alignment }) => (
          <button
            key={id}
            type="button"
            className={`source-format-btn ${getColumnAlignment(tableInfo) === alignment ? "active" : ""}`}
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleAlignment(alignment)}
          >
            {icon}
          </button>
        ))}
        <div className="source-format-separator" />
        {ALIGN_ALL_BUTTONS.map(({ id, icon, label, alignment }) => (
          <button
            key={id}
            type="button"
            className="source-format-btn"
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleAlignAll(alignment)}
          >
            {icon}
          </button>
        ))}
        <div className="source-format-separator" />
        <button
          type="button"
          className="source-format-btn"
          title="Format table (space-padded)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleFormatTable}
        >
          {createIcon(icons.formatTable)}
        </button>
      </div>
    </div>
  );
}
