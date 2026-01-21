/**
 * Source Mode Table Context Menu
 *
 * CodeMirror 6 plugin that shows a context menu when right-clicking
 * inside a markdown table in Source mode.
 */

import { EditorView, ViewPlugin } from "@codemirror/view";
import { icons } from "@/utils/icons";
import { getPopupHost, toHostCoords } from "@/plugins/sourcePopup";
import {
  getSourceTableInfo,
  insertRowAbove,
  insertRowBelow,
  insertColumnLeft,
  insertColumnRight,
  deleteRow,
  deleteColumn,
  deleteTable,
  setColumnAlignment,
  setAllColumnsAlignment,
  formatTable,
  type SourceTableInfo,
  type TableAlignment,
} from "@/plugins/sourceContextDetection/tableDetection";

interface MenuAction {
  label: string;
  icon: string;
  action: (view: EditorView, info: SourceTableInfo) => void;
  dividerAfter?: boolean;
  danger?: boolean;
}

/**
 * Source Table Context Menu View
 */
class SourceTableContextMenuView {
  private container: HTMLElement;
  private isVisible = false;
  private host: HTMLElement;

  constructor(private view: EditorView) {
    this.container = this.buildContainer();
    this.host = getPopupHost(view) ?? view.dom;
    this.container.style.position = "absolute";
    this.host.appendChild(this.container);
    document.addEventListener("mousedown", this.handleClickOutside);
    document.addEventListener("keydown", this.handleKeydown);
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "table-context-menu";
    container.style.display = "none";
    return container;
  }

  private buildMenu(info: SourceTableInfo): void {
    this.container.innerHTML = "";

    const alignCol =
      (alignment: TableAlignment) => (view: EditorView, info: SourceTableInfo) =>
        setColumnAlignment(view, info, alignment);

    const alignAll =
      (alignment: TableAlignment) => (view: EditorView, info: SourceTableInfo) =>
        setAllColumnsAlignment(view, info, alignment);

    const actions: MenuAction[] = [
      {
        label: "Insert Row Above",
        icon: icons.rowAbove,
        action: (v, i) => insertRowAbove(v, i),
      },
      {
        label: "Insert Row Below",
        icon: icons.rowBelow,
        action: (v, i) => insertRowBelow(v, i),
      },
      {
        label: "Insert Column Left",
        icon: icons.colLeft,
        action: (v, i) => insertColumnLeft(v, i),
      },
      {
        label: "Insert Column Right",
        icon: icons.colRight,
        action: (v, i) => insertColumnRight(v, i),
        dividerAfter: true,
      },
      {
        label: "Delete Row",
        icon: icons.deleteRow,
        action: (v, i) => deleteRow(v, i),
        danger: true,
      },
      {
        label: "Delete Column",
        icon: icons.deleteCol,
        action: (v, i) => deleteColumn(v, i),
        danger: true,
      },
      {
        label: "Delete Table",
        icon: icons.deleteTable,
        action: (v, i) => deleteTable(v, i),
        danger: true,
        dividerAfter: true,
      },
      {
        label: "Align Column Left",
        icon: icons.alignLeft,
        action: alignCol("left"),
      },
      {
        label: "Align Column Center",
        icon: icons.alignCenter,
        action: alignCol("center"),
      },
      {
        label: "Align Column Right",
        icon: icons.alignRight,
        action: alignCol("right"),
        dividerAfter: true,
      },
      {
        label: "Align All Left",
        icon: icons.alignAllLeft,
        action: alignAll("left"),
      },
      {
        label: "Align All Center",
        icon: icons.alignAllCenter,
        action: alignAll("center"),
      },
      {
        label: "Align All Right",
        icon: icons.alignAllRight,
        action: alignAll("right"),
        dividerAfter: true,
      },
      {
        label: "Format Table",
        icon: icons.formatTable,
        action: (v, i) => formatTable(v, i),
      },
    ];

    for (const item of actions) {
      const menuItem = document.createElement("button");
      menuItem.className = `table-context-menu-item${
        item.danger ? " table-context-menu-item-danger" : ""
      }`;
      menuItem.type = "button";

      const iconSpan = document.createElement("span");
      iconSpan.className = "table-context-menu-icon";
      iconSpan.innerHTML = item.icon;
      menuItem.appendChild(iconSpan);

      const labelSpan = document.createElement("span");
      labelSpan.className = "table-context-menu-label";
      labelSpan.textContent = item.label;
      menuItem.appendChild(labelSpan);

      menuItem.addEventListener("mousedown", (e) => e.preventDefault());
      menuItem.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.action(this.view, info);
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

  show(x: number, y: number, info: SourceTableInfo): void {
    this.buildMenu(info);

    this.container.style.display = "flex";
    const hostPos = toHostCoords(this.host, { top: y, left: x });
    this.container.style.left = `${hostPos.left}px`;
    this.container.style.top = `${hostPos.top}px`;

    requestAnimationFrame(() => {
      const rect = this.container.getBoundingClientRect();
      const hostRect = this.host.getBoundingClientRect();
      const hostWidth = hostRect.width;
      const hostHeight = hostRect.height;

      if (rect.right > hostRect.right - 10) {
        const adjustedLeft = hostWidth - rect.width - 10 + this.host.scrollLeft;
        this.container.style.left = `${adjustedLeft}px`;
      }

      if (rect.bottom > hostRect.bottom - 10) {
        const adjustedTop = hostHeight - rect.height - 10 + this.host.scrollTop;
        this.container.style.top = `${adjustedTop}px`;
      }
    });

    this.isVisible = true;
  }

  hide(): void {
    this.container.style.display = "none";
    this.isVisible = false;
  }

  private handleClickOutside = (e: MouseEvent): void => {
    if (!this.isVisible) return;
    const target = e.target as Node;
    if (!this.container.contains(target)) {
      this.hide();
    }
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.isVisible) {
      this.hide();
      this.view.focus();
    }
  };

  destroy(): void {
    document.removeEventListener("mousedown", this.handleClickOutside);
    document.removeEventListener("keydown", this.handleKeydown);
    this.container.remove();
  }
}

/**
 * Creates the source table context menu plugin.
 */
export function createSourceTableContextMenuPlugin() {
  return ViewPlugin.fromClass(
    class {
      private contextMenu: SourceTableContextMenuView;

      constructor(view: EditorView) {
        this.contextMenu = new SourceTableContextMenuView(view);
      }

      destroy() {
        this.contextMenu.destroy();
      }
    }
  );
}

/**
 * Context menu event handler for tables.
 */
export function createTableContextMenuHandler() {
  let contextMenu: SourceTableContextMenuView | null = null;

  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      // Move cursor to click position
      view.dispatch({
        selection: { anchor: pos },
      });

      // Check if inside table
      const tableInfo = getSourceTableInfo(view);
      if (!tableInfo) return false;

      event.preventDefault();

      // Create context menu if not exists
      if (!contextMenu) {
        contextMenu = new SourceTableContextMenuView(view);
      }

      contextMenu.show(event.clientX, event.clientY, tableInfo);
      return true;
    },
  });
}

/**
 * All extensions for source table context menu.
 */
export const sourceTableContextMenuExtensions = [createTableContextMenuHandler()];
