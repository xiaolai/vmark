/**
 * Table Context Menu
 *
 * Right-click menu for table editing operations.
 * Shows when right-clicking on a table cell.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import type { Ctx } from "@milkdown/kit/ctx";
import { callCommand } from "@milkdown/kit/utils";
import {
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  deleteSelectedCellsCommand,
  selectRowCommand,
  selectColCommand,
  setAlignCommand,
} from "@milkdown/kit/preset/gfm";
import { useTableToolbarStore } from "@/stores/tableToolbarStore";
import { deleteTableAtPos, getTableInfo } from "./table-utils";

// Interface for editor-like object with action method
interface EditorLike {
  action: (fn: (ctx: Ctx) => void) => void;
}

interface MenuAction {
  label: string;
  icon?: string;
  action: () => void;
  dividerAfter?: boolean;
  danger?: boolean;
}

/**
 * Table context menu - manages the right-click menu UI.
 */
export class TableContextMenu {
  private container: HTMLElement;
  private editorView: EditorView;
  private getEditor: () => EditorLike | undefined;
  private isVisible = false;

  constructor(view: EditorView, getEditor: () => EditorLike | undefined) {
    this.editorView = view;
    this.getEditor = getEditor;

    // Build DOM structure
    this.container = this.buildContainer();

    // Append to document body
    document.body.appendChild(this.container);

    // Handle click outside to close
    document.addEventListener("mousedown", this.handleClickOutside);
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "table-context-menu";
    container.style.display = "none";
    return container;
  }

  private buildMenu(): void {
    // Clear existing content
    this.container.innerHTML = "";

    const actions: MenuAction[] = [
      {
        label: "Insert Row Above",
        action: () => this.executeCommand(addRowBeforeCommand),
      },
      {
        label: "Insert Row Below",
        action: () => this.executeCommand(addRowAfterCommand),
      },
      {
        label: "Insert Column Left",
        action: () => this.executeCommand(addColBeforeCommand),
      },
      {
        label: "Insert Column Right",
        action: () => this.executeCommand(addColAfterCommand),
        dividerAfter: true,
      },
      {
        label: "Delete Row",
        action: () => this.handleDeleteRow(),
        danger: true,
      },
      {
        label: "Delete Column",
        action: () => this.handleDeleteCol(),
        danger: true,
      },
      {
        label: "Delete Table",
        action: () => this.handleDeleteTable(),
        danger: true,
        dividerAfter: true,
      },
      {
        label: "Align Left",
        action: () => this.executeCommand(setAlignCommand, "left"),
      },
      {
        label: "Align Center",
        action: () => this.executeCommand(setAlignCommand, "center"),
      },
      {
        label: "Align Right",
        action: () => this.executeCommand(setAlignCommand, "right"),
      },
    ];

    for (const item of actions) {
      const menuItem = document.createElement("button");
      menuItem.className = `table-context-menu-item${item.danger ? " table-context-menu-item-danger" : ""}`;
      menuItem.type = "button";
      menuItem.textContent = item.label;
      menuItem.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.action();
        this.hide();
      });

      this.container.appendChild(menuItem);

      if (item.dividerAfter) {
        const divider = document.createElement("div");
        divider.className = "table-context-menu-divider";
        this.container.appendChild(divider);
      }
    }
  }

  show(x: number, y: number) {
    // Build fresh menu
    this.buildMenu();

    this.container.style.display = "flex";
    this.container.style.position = "fixed";

    // Position at click location
    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;

    // Ensure menu stays within viewport
    requestAnimationFrame(() => {
      const rect = this.container.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust horizontal position if needed
      if (rect.right > viewportWidth - 10) {
        this.container.style.left = `${viewportWidth - rect.width - 10}px`;
      }

      // Adjust vertical position if needed
      if (rect.bottom > viewportHeight - 10) {
        this.container.style.top = `${viewportHeight - rect.height - 10}px`;
      }
    });

    this.isVisible = true;
  }

  hide() {
    this.container.style.display = "none";
    this.isVisible = false;
  }

  get visible(): boolean {
    return this.isVisible;
  }

  private executeCommand<T>(command: { key: unknown }, payload?: T) {
    const editor = this.getEditor();
    if (!editor) return;

    // Focus editor BEFORE command to ensure selection is valid
    this.editorView.focus();
    editor.action(callCommand(command.key as never, payload as never));
  }

  private executeCommandsWithPayloads(
    commands: Array<{ command: { key: unknown }; payload?: unknown }>
  ) {
    const editor = this.getEditor();
    if (!editor) return;

    // Focus editor BEFORE commands to ensure selection is valid
    this.editorView.focus();
    editor.action((ctx) => {
      for (const { command, payload } of commands) {
        callCommand(command.key as never, payload as never)(ctx);
      }
    });
  }

  private handleDeleteRow() {
    // Get current row index and select it, then delete
    const tableInfo = getTableInfo(this.editorView);
    if (!tableInfo) return;

    this.executeCommandsWithPayloads([
      { command: selectRowCommand, payload: { index: tableInfo.rowIndex } },
      { command: deleteSelectedCellsCommand },
    ]);
  }

  private handleDeleteCol() {
    // Get current column index and select it, then delete
    const tableInfo = getTableInfo(this.editorView);
    if (!tableInfo) return;

    this.executeCommandsWithPayloads([
      { command: selectColCommand, payload: { index: tableInfo.colIndex } },
      { command: deleteSelectedCellsCommand },
    ]);
  }

  private handleDeleteTable() {
    const { tablePos } = useTableToolbarStore.getState();
    if (deleteTableAtPos(this.editorView, tablePos)) {
      useTableToolbarStore.getState().closeToolbar();
    }
  }

  private handleClickOutside = (e: MouseEvent) => {
    if (!this.isVisible) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      this.hide();
    }
  };

  destroy() {
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}
