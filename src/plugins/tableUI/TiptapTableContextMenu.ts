import type { EditorView } from "@tiptap/pm/view";
import { alignColumn, type TableAlignment, addColLeft, addColRight, addRowAbove, addRowBelow, deleteCurrentColumn, deleteCurrentRow, deleteCurrentTable } from "./tableActions.tiptap";

interface MenuAction {
  label: string;
  action: () => void;
  dividerAfter?: boolean;
  danger?: boolean;
}

export class TiptapTableContextMenu {
  private container: HTMLElement;
  private editorView: EditorView;
  private isVisible = false;

  constructor(view: EditorView) {
    this.editorView = view;
    this.container = this.buildContainer();
    document.body.appendChild(this.container);
    document.addEventListener("mousedown", this.handleClickOutside);
  }

  updateView(view: EditorView) {
    this.editorView = view;
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "table-context-menu";
    container.style.display = "none";
    return container;
  }

  private buildMenu(): void {
    this.container.innerHTML = "";

    const alignCol = (alignment: TableAlignment) => () => alignColumn(this.editorView, alignment, false);
    const alignAll = (alignment: TableAlignment) => () => alignColumn(this.editorView, alignment, true);

    const actions: MenuAction[] = [
      { label: "Insert Row Above", action: () => addRowAbove(this.editorView) },
      { label: "Insert Row Below", action: () => addRowBelow(this.editorView) },
      { label: "Insert Column Left", action: () => addColLeft(this.editorView) },
      { label: "Insert Column Right", action: () => addColRight(this.editorView), dividerAfter: true },
      { label: "Delete Row", action: () => deleteCurrentRow(this.editorView), danger: true },
      { label: "Delete Column", action: () => deleteCurrentColumn(this.editorView), danger: true },
      { label: "Delete Table", action: () => deleteCurrentTable(this.editorView), danger: true, dividerAfter: true },
      { label: "Align Column Left", action: alignCol("left") },
      { label: "Align Column Center", action: alignCol("center") },
      { label: "Align Column Right", action: alignCol("right"), dividerAfter: true },
      { label: "Align All Left", action: alignAll("left") },
      { label: "Align All Center", action: alignAll("center") },
      { label: "Align All Right", action: alignAll("right") },
    ];

    for (const item of actions) {
      const menuItem = document.createElement("button");
      menuItem.className = `table-context-menu-item${item.danger ? " table-context-menu-item-danger" : ""}`;
      menuItem.type = "button";
      menuItem.textContent = item.label;
      menuItem.addEventListener("mousedown", (e) => e.preventDefault());
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
    this.buildMenu();

    this.container.style.display = "flex";
    this.container.style.position = "fixed";
    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;

    requestAnimationFrame(() => {
      const rect = this.container.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth - 10) {
        this.container.style.left = `${viewportWidth - rect.width - 10}px`;
      }

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

