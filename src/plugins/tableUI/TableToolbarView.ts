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
import { deleteTableAtPos, deleteRow, deleteColumn, isInHeaderRow, alignAllColumns, formatTable } from "./table-utils";

// SVG Icons (row/col insert icons from source mode, delete icons with line-through style)
const icons = {
  addRowAbove: `<svg viewBox="0 0 24 24"><path d="M5 3h14"/><path d="m12 10-4-4 4-4"/><path d="M12 6v8"/><rect width="20" height="8" x="2" y="14" rx="2"/></svg>`,
  addRowBelow: `<svg viewBox="0 0 24 24"><path d="M5 21h14"/><path d="m12 14 4 4-4 4"/><path d="M12 18v-8"/><rect width="20" height="8" x="2" y="2" rx="2"/></svg>`,
  addColLeft: `<svg viewBox="0 0 24 24"><path d="M3 5v14"/><path d="m10 12-4-4 4-4"/><path d="M6 12h8"/><rect width="8" height="20" x="14" y="2" rx="2"/></svg>`,
  addColRight: `<svg viewBox="0 0 24 24"><path d="M21 5v14"/><path d="m14 12 4-4-4-4"/><path d="M18 12h-8"/><rect width="8" height="20" x="2" y="2" rx="2"/></svg>`,
  deleteRow: `<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><rect x="3" y="6" width="18" height="12" rx="2" fill="none"/></svg>`,
  deleteCol: `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><rect x="6" y="3" width="12" height="18" rx="2" fill="none"/></svg>`,
  deleteTable: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  alignLeft: `<svg viewBox="0 0 24 24"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`,
  alignCenter: `<svg viewBox="0 0 24 24"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg>`,
  alignRight: `<svg viewBox="0 0 24 24"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/></svg>`,
  // Align all icons (with table outline indicator)
  alignAllLeft: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="14" y2="16"/></svg>`,
  alignAllCenter: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>`,
  alignAllRight: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><line x1="10" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="16" x2="17" y2="16"/></svg>`,
  // Format table (space-padded)
  formatTable: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`,
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
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

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

  private getFocusableElements(): HTMLElement[] {
    return Array.from(
      this.container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  private setupKeyboardNavigation() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        useTableToolbarStore.getState().closeToolbar();
        this.editorView.focus();
        return;
      }

      if (e.key === "Tab") {
        const focusable = this.getFocusableElements();
        if (focusable.length === 0) return;

        const activeEl = document.activeElement as HTMLElement;
        const currentIndex = focusable.indexOf(activeEl);

        // Only handle Tab if focus is inside the toolbar
        if (currentIndex === -1) return;

        e.preventDefault();

        if (e.shiftKey) {
          const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
          focusable[prevIndex].focus();
        } else {
          const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
          focusable[nextIndex].focus();
        }
      }
    };

    document.addEventListener("keydown", this.keydownHandler);
  }

  private removeKeyboardNavigation() {
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
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

    // Second row: column alignment (Shift+click for whole table)
    const row2 = document.createElement("div");
    row2.className = "table-toolbar-row";

    row2.appendChild(this.buildAlignButton(icons.alignLeft, "Align column left (Shift: all)", "left"));
    row2.appendChild(this.buildAlignButton(icons.alignCenter, "Align column center (Shift: all)", "center"));
    row2.appendChild(this.buildAlignButton(icons.alignRight, "Align column right (Shift: all)", "right"));
    row2.appendChild(this.buildDivider());
    row2.appendChild(this.buildButton(icons.alignAllLeft, "Align all left", () => this.handleAlignAll("left")));
    row2.appendChild(this.buildButton(icons.alignAllCenter, "Align all center", () => this.handleAlignAll("center")));
    row2.appendChild(this.buildButton(icons.alignAllRight, "Align all right", () => this.handleAlignAll("right")));
    row2.appendChild(this.buildDivider());
    row2.appendChild(this.buildButton(icons.formatTable, "Format table (space-padded)", this.handleFormatTable));

    container.appendChild(row1);
    container.appendChild(row2);

    return container;
  }

  private buildButton(
    iconSvg: string,
    title: string,
    onClick: (e: MouseEvent) => void,
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
      onClick(e);
    });
    return btn;
  }

  private buildAlignButton(
    iconSvg: string,
    title: string,
    alignment: "left" | "center" | "right"
  ): HTMLElement {
    return this.buildButton(iconSvg, title, (e) => {
      if (e.shiftKey) {
        // Shift+click: align all columns
        this.editorView.focus();
        alignAllColumns(this.editorView, alignment);
      } else {
        // Normal click: align current column (uses executeCommand which focuses)
        this.executeCommand(setAlignCommand, alignment);
      }
    });
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

    // Set up keyboard navigation
    this.setupKeyboardNavigation();

    // Focus first button after a short delay
    setTimeout(() => {
      const focusable = this.getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 50);
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
    this.removeKeyboardNavigation();
  }

  private executeCommand<T>(command: { key: unknown }, payload?: T) {
    const editor = this.getEditor();
    if (!editor) return;

    // Focus editor BEFORE command to ensure selection is valid
    this.editorView.focus();
    editor.action(callCommand(command.key as never, payload as never));
  }

  private handleAddRowAbove = () => {
    // Can't insert above header row in GFM tables - insert below instead
    if (isInHeaderRow(this.editorView)) {
      this.executeCommand(addRowAfterCommand);
      return;
    }
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

  private handleAlignAll = (alignment: "left" | "center" | "right") => {
    this.editorView.focus();
    alignAllColumns(this.editorView, alignment);
  };

  private handleFormatTable = () => {
    this.editorView.focus();
    formatTable(this.editorView);
  };

  destroy() {
    this.unsubscribe();
    this.removeKeyboardNavigation();
    this.container.remove();
  }
}
