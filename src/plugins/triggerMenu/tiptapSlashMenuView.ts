import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { createSlashMenuItems } from "./tiptapSlashMenuItems";
import { filterSlashMenuItems, groupSlashMenuItems, type SlashMenuItem } from "./tiptapSlashMenuUtils";
import { buildEmptyState, buildGroup, buildMenuItem } from "./tiptapSlashMenuDom";
import { findSlashMenuMatch, type SlashMatch } from "./tiptapSlashMenuMatch";
import { positionSubmenu, updateMenuPosition } from "./tiptapSlashMenuPosition";

type MenuLevel = {
  items: SlashMenuItem[];
  selectedIndex: number;
  elements: HTMLElement[];
  container: HTMLElement;
  parentItemEl: HTMLElement | null;
};

export class SlashMenuView {
  private editor: TiptapEditor;
  private rootItems: SlashMenuItem[];

  private match: SlashMatch | null = null;
  private menuEl: HTMLElement | null = null;
  private levels: MenuLevel[] = [];

  private handleDocumentMouseDown = (event: MouseEvent) => {
    if (!this.menuEl) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (this.menuEl.contains(target)) return;
    this.hide();
  };

  constructor(editor: TiptapEditor) {
    this.editor = editor;
    this.rootItems = createSlashMenuItems(editor);
  }

  destroy() {
    this.hide();
  }

  update(view: EditorView) {
    const nextMatch = findSlashMenuMatch(view);
    if (!nextMatch) {
      this.hide();
      return;
    }

    const queryChanged = nextMatch.query !== this.match?.query;
    this.match = nextMatch;

    if (!this.menuEl) {
      this.show();
      this.resetLevels();
      this.render();
      this.updatePosition();
      return;
    }

    if (queryChanged) this.resetLevels();
    this.render();
    this.updatePosition();
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.isComposing || event.keyCode === 229) return false;
    if (!this.menuEl) return false;
    const levelIndex = this.levels.length - 1;
    const level = this.levels[levelIndex];
    if (!level) return false;

    if (event.key === "Escape") {
      event.preventDefault();
      this.hide();
      return true;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.setSelectedIndex(levelIndex, (level.selectedIndex + 1) % level.items.length);
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = level.selectedIndex - 1 < 0 ? level.items.length - 1 : level.selectedIndex - 1;
      this.setSelectedIndex(levelIndex, next);
      return true;
    }

    if (event.key === "ArrowLeft") {
      if (this.levels.length > 1) {
        event.preventDefault();
        this.closeSubmenu();
        return true;
      }
      return false;
    }

    if (event.key === "ArrowRight" || event.key === "Enter") {
      const item = level.items[level.selectedIndex];
      if (!item) return false;
      event.preventDefault();
      if (!this.match?.query && item.children?.length) {
        this.openSubmenu(levelIndex, item);
        return true;
      }
      this.runItem(item);
      return true;
    }

    return false;
  }

  private show() {
    if (this.menuEl) return;
    const menu = document.createElement("div");
    menu.className = "trigger-menu";
    menu.style.position = "absolute";
    menu.style.display = "none";

    const root = document.createElement("div");
    root.className = "trigger-menu-root";
    menu.appendChild(root);

    document.body.appendChild(menu);
    document.addEventListener("mousedown", this.handleDocumentMouseDown, true);
    this.menuEl = menu;
  }

  private hide() {
    if (!this.menuEl) return;
    document.removeEventListener("mousedown", this.handleDocumentMouseDown, true);
    this.menuEl.remove();
    this.menuEl = null;
    this.match = null;
    this.levels = [];
  }

  private resetLevels() {
    if (!this.menuEl) return;
    const root = this.menuEl.querySelector(".trigger-menu-root") as HTMLElement | null;
    if (!root) return;

    for (const level of this.levels.slice(1)) level.container.remove();
    this.levels = [{ items: [], selectedIndex: 0, elements: [], container: root, parentItemEl: null }];
  }

  private render() {
    if (!this.menuEl || !this.match) return;
    this.menuEl.style.display = "block";

    const rootLevel = this.levels[0];
    if (!rootLevel) return;

    const searchMode = Boolean(this.match.query.trim());
    const items = searchMode ? filterSlashMenuItems(this.rootItems, this.match.query) : this.rootItems;

    rootLevel.items = items;
    rootLevel.selectedIndex = Math.min(rootLevel.selectedIndex, Math.max(0, items.length - 1));
    rootLevel.container.replaceChildren();
    rootLevel.elements = [];

    if (items.length === 0) {
      rootLevel.container.appendChild(buildEmptyState());
      return;
    }

    if (searchMode) {
      const groups = groupSlashMenuItems(items);
      let offset = 0;
      for (const [groupName, groupItems] of groups) {
        const groupEl = buildGroup(groupName);
        rootLevel.container.appendChild(groupEl);
        this.renderItemsInto(rootLevel, groupItems, groupEl, offset);
        offset += groupItems.length;
      }
    } else {
      this.renderItemsInto(rootLevel, items, rootLevel.container, 0);
    }

    this.closeSubmenusAfter(0);
    this.applySelectionHighlight(0);
  }

  private renderItemsInto(level: MenuLevel, items: SlashMenuItem[], container: HTMLElement, offset: number) {
    const levelIndex = this.levels.indexOf(level);

    items.forEach((item, i) => {
      const index = offset + i;
      const el = buildMenuItem(item, index, index === level.selectedIndex, Boolean(item.children?.length));

      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.setSelectedIndex(levelIndex, index);
        if (!this.match?.query && item.children?.length) return this.openSubmenu(levelIndex, item);
        this.runItem(item);
      });

      el.addEventListener("mouseenter", () => {
        this.setSelectedIndex(levelIndex, index);
        if (this.match?.query) return;
        if (item.children?.length) return this.openSubmenu(levelIndex, item);
        this.closeSubmenusAfter(levelIndex);
      });

      container.appendChild(el);
      level.elements[index] = el;
    });
  }

  private setSelectedIndex(levelIndex: number, index: number) {
    const level = this.levels[levelIndex];
    if (!level || level.items.length === 0) return;

    const next = Math.max(0, Math.min(index, level.items.length - 1));
    if (next === level.selectedIndex) return;

    this.closeSubmenusAfter(levelIndex);
    level.selectedIndex = next;
    this.applySelectionHighlight(levelIndex);
  }

  private applySelectionHighlight(levelIndex: number) {
    const level = this.levels[levelIndex];
    if (!level) return;

    for (const [i, el] of level.elements.entries()) {
      if (!el) continue;
      el.classList.toggle("selected", i === level.selectedIndex);
      if (i === level.selectedIndex) el.scrollIntoView({ block: "nearest" });
    }
  }

  private closeSubmenusAfter(levelIndex: number) {
    for (let i = this.levels.length - 1; i > levelIndex; i--) {
      this.levels[i]?.container.remove();
      this.levels.pop();
    }
  }

  private closeSubmenu() {
    if (this.levels.length <= 1) return;
    const last = this.levels.pop();
    last?.container.remove();
  }

  private openSubmenu(parentLevelIndex: number, item: SlashMenuItem) {
    if (!this.menuEl || !item.children?.length) return;
    const parentLevel = this.levels[parentLevelIndex];
    if (!parentLevel) return;

    const parentItemEl = parentLevel.elements[parentLevel.selectedIndex] ?? null;
    if (!parentItemEl) return;

    this.closeSubmenusAfter(parentLevelIndex);

    const submenu = document.createElement("div");
    submenu.className = "trigger-menu-submenu";
    submenu.style.position = "absolute";
    this.menuEl.appendChild(submenu);

    const nextLevel: MenuLevel = { items: item.children, selectedIndex: 0, elements: [], container: submenu, parentItemEl };
    this.levels.push(nextLevel);

    submenu.replaceChildren();
    this.renderItemsInto(nextLevel, nextLevel.items, submenu, 0);
    positionSubmenu(this.menuEl, nextLevel);
    this.applySelectionHighlight(this.levels.length - 1);
  }

  private runItem(item: SlashMenuItem) {
    if (!this.match) return;
    this.editor.chain().focus().deleteRange(this.match.range).run();
    void item.action?.();
    this.hide();
  }

  private updatePosition() {
    if (!this.menuEl || !this.match) return;
    updateMenuPosition(this.menuEl, this.match.coords, this.levels);
  }
}
