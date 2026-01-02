/**
 * Table Toolbar View
 *
 * DOM management for the table editing toolbar.
 * Shows when cursor is in table, provides editing actions.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import type { Ctx } from "@milkdown/kit/ctx";
import { callCommand } from "@milkdown/kit/utils";

// Interface for editor-like object with action method
interface EditorLike {
  action: (fn: (ctx: Ctx) => void) => void;
}
import {
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  setAlignCommand,
} from "@milkdown/kit/preset/gfm";
import { useTableToolbarStore } from "@/stores/tableToolbarStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { deleteTableAtPos, deleteRow, deleteColumn } from "./table-utils";

// SVG Icons
const icons = {
  addRowAbove: `<svg viewBox="0 0 24 24"><path d="M19 14v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5"/><line x1="12" y1="3" x2="12" y2="11"/><polyline points="8 7 12 3 16 7"/></svg>`,
  addRowBelow: `<svg viewBox="0 0 24 24"><path d="M5 10V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5"/><line x1="12" y1="21" x2="12" y2="13"/><polyline points="16 17 12 21 8 17"/></svg>`,
  addColLeft: `<svg viewBox="0 0 24 24"><path d="M14 5h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/><line x1="3" y1="12" x2="11" y2="12"/><polyline points="7 8 3 12 7 16"/></svg>`,
  addColRight: `<svg viewBox="0 0 24 24"><path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5"/><line x1="21" y1="12" x2="13" y2="12"/><polyline points="17 16 21 12 17 8"/></svg>`,
  deleteRow: `<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><rect x="3" y="6" width="18" height="12" rx="2" fill="none"/></svg>`,
  deleteCol: `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><rect x="6" y="3" width="12" height="18" rx="2" fill="none"/></svg>`,
  deleteTable: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  alignLeft: `<svg viewBox="0 0 24 24"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`,
  alignCenter: `<svg viewBox="0 0 24 24"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg>`,
  alignRight: `<svg viewBox="0 0 24 24"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/></svg>`,
};

/**
 * Table toolbar view - manages the floating toolbar UI.
 */
export class TableToolbarView {
  private container: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private getEditor: () => EditorLike | undefined;
  private wasOpen = false;

  constructor(view: EditorView, getEditor: () => EditorLike | undefined) {
    this.editorView = view;
    this.getEditor = getEditor;

    // Build DOM structure
    this.container = this.buildContainer();

    // Append to document body
    document.body.appendChild(this.container);

    // Subscribe to store changes
    this.unsubscribe = useTableToolbarStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        if (!this.wasOpen) {
          this.show(state.anchorRect);
        } else {
          this.updatePosition(state.anchorRect);
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "table-toolbar";
    container.style.display = "none";

    // First row: add/delete operations
    const row1 = document.createElement("div");
    row1.className = "table-toolbar-row";

    row1.appendChild(this.buildButton(icons.addRowAbove, "Insert row above", this.handleAddRowAbove));
    row1.appendChild(this.buildButton(icons.addRowBelow, "Insert row below", this.handleAddRowBelow));
    row1.appendChild(this.buildDivider());
    row1.appendChild(this.buildButton(icons.addColLeft, "Insert column left", this.handleAddColLeft));
    row1.appendChild(this.buildButton(icons.addColRight, "Insert column right", this.handleAddColRight));
    row1.appendChild(this.buildDivider());
    row1.appendChild(this.buildButton(icons.deleteRow, "Delete row", this.handleDeleteRow, "danger"));
    row1.appendChild(this.buildButton(icons.deleteCol, "Delete column", this.handleDeleteCol, "danger"));
    row1.appendChild(this.buildButton(icons.deleteTable, "Delete table", this.handleDeleteTable, "danger"));

    // Second row: alignment
    const row2 = document.createElement("div");
    row2.className = "table-toolbar-row";

    row2.appendChild(this.buildButton(icons.alignLeft, "Align left", this.handleAlignLeft));
    row2.appendChild(this.buildButton(icons.alignCenter, "Align center", this.handleAlignCenter));
    row2.appendChild(this.buildButton(icons.alignRight, "Align right", this.handleAlignRight));

    container.appendChild(row1);
    container.appendChild(row2);

    return container;
  }

  private buildButton(
    iconSvg: string,
    title: string,
    onClick: () => void,
    variant?: "danger"
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.className = `table-toolbar-btn${variant ? ` table-toolbar-btn-${variant}` : ""}`;
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;
    // Prevent mousedown from stealing focus from editor
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private buildDivider(): HTMLElement {
    const divider = document.createElement("div");
    divider.className = "table-toolbar-divider";
    return divider;
  }

  private show(anchorRect: AnchorRect) {
    this.container.style.display = "flex";
    this.container.style.position = "fixed";
    this.updatePosition(anchorRect);
  }

  private updatePosition(anchorRect: AnchorRect) {
    // Get boundaries
    const containerEl = this.editorView.dom.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    // Measure toolbar
    const toolbarWidth = this.container.offsetWidth || 320;
    const toolbarHeight = this.container.offsetHeight || 60;

    // Calculate position - prefer above the table
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: toolbarWidth, height: toolbarHeight },
      bounds,
      gap: 8,
      preferAbove: true,
    });

    this.container.style.top = `${top}px`;
    this.container.style.left = `${left}px`;
  }

  private hide() {
    this.container.style.display = "none";
  }

  private executeCommand<T>(command: { key: unknown }, payload?: T) {
    const editor = this.getEditor();
    if (!editor) return;

    // Focus editor BEFORE command to ensure selection is valid
    this.editorView.focus();
    editor.action(callCommand(command.key as never, payload as never));
  }

  private handleAddRowAbove = () => {
    this.executeCommand(addRowBeforeCommand);
  };

  private handleAddRowBelow = () => {
    this.executeCommand(addRowAfterCommand);
  };

  private handleAddColLeft = () => {
    this.executeCommand(addColBeforeCommand);
  };

  private handleAddColRight = () => {
    this.executeCommand(addColAfterCommand);
  };

  private handleDeleteRow = () => {
    deleteRow(this.editorView);
  };

  private handleDeleteCol = () => {
    deleteColumn(this.editorView);
  };

  private handleDeleteTable = () => {
    const { tablePos } = useTableToolbarStore.getState();
    if (deleteTableAtPos(this.editorView, tablePos)) {
      useTableToolbarStore.getState().closeToolbar();
    }
  };

  private handleAlignLeft = () => {
    this.executeCommand(setAlignCommand, "left");
  };

  private handleAlignCenter = () => {
    this.executeCommand(setAlignCommand, "center");
  };

  private handleAlignRight = () => {
    this.executeCommand(setAlignCommand, "right");
  };

  destroy() {
    this.unsubscribe();
    this.container.remove();
  }
}
