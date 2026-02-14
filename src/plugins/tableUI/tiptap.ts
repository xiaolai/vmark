/**
 * Table UI Extension
 *
 * Purpose: Orchestrates all table-related UI features for WYSIWYG mode: context menu,
 * column resize handles, keyboard navigation (Tab between cells, arrow escape),
 * and row insertion shortcuts.
 *
 * Pipeline: ProseMirror plugin view → detects active table → mounts context menu
 *           and resize handles → cleans up when table loses focus
 *
 * Key decisions:
 *   - Context menu is imperative DOM (not React) for performance in large documents
 *   - Column resize uses CSS widths only (not persisted to markdown)
 *   - Enter in table adds row below instead of splitting paragraph
 *
 * @coordinates-with tableActions.tiptap.ts — row/column CRUD commands
 * @coordinates-with TiptapTableContextMenu.ts — right-click context menu
 * @coordinates-with columnResize.ts — drag-to-resize column handles
 * @coordinates-with tableEscape.ts — arrow key escape from table boundaries
 * @module plugins/tableUI/tiptap
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Command } from "@tiptap/pm/state";
import { keymap } from "@tiptap/pm/keymap";
import type { EditorView } from "@tiptap/pm/view";
import { goToNextCell } from "@tiptap/pm/tables";
import { ColumnResizeManager } from "./columnResize";
import { TiptapTableContextMenu } from "./TiptapTableContextMenu";
import { addRowAbove, addRowBelow, isInTable } from "./tableActions.tiptap";
import { escapeTableUp, escapeTableDown } from "./tableEscape";
import { getActiveTableElement } from "./tableDom";
import { guardProseMirrorCommand } from "@/utils/imeGuard";

interface TableUIPluginState {
  contextMenu: TiptapTableContextMenu | null;
}

export const tiptapTableUIPluginKey = new PluginKey<TableUIPluginState>("tiptapTableUI");

class TiptapTableUIPluginView {
  private contextMenu: TiptapTableContextMenu;
  private columnResize: ColumnResizeManager;
  private view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.contextMenu = new TiptapTableContextMenu(view);
    this.columnResize = new ColumnResizeManager(view as unknown as never);

    const tr = view.state.tr.setMeta(tiptapTableUIPluginKey, { contextMenu: this.contextMenu });
    view.dispatch(tr);
  }

  update(view: EditorView) {
    this.view = view;
    this.contextMenu.updateView(view);
    if (!isInTable(view)) return;

    const table = getActiveTableElement(view);
    if (table) {
      this.columnResize.scheduleUpdate(table);
    }
  }

  destroy() {
    this.contextMenu.destroy();
    this.columnResize.destroy();

    const tr = this.view.state.tr.setMeta(tiptapTableUIPluginKey, { contextMenu: null });
    try {
      this.view.dispatch(tr);
    } catch {
      // View may already be destroyed
    }
  }
}

function cmdWhenInTable(fn: (view: EditorView) => boolean): Command {
  return (_state, _dispatch, view) => {
    if (!view) return false;
    if (!isInTable(view as unknown as EditorView)) return false;
    return fn(view as unknown as EditorView);
  };
}

export const tableUIExtension = Extension.create({
  name: "tableUI",
  priority: 1050,
  addProseMirrorPlugins() {
    const goNext = guardProseMirrorCommand(goToNextCell(1));
    const goPrev = guardProseMirrorCommand(goToNextCell(-1));

    return [
      keymap({
        Tab: goNext,
        "Shift-Tab": goPrev,
        "Mod-Enter": guardProseMirrorCommand(cmdWhenInTable((view) => addRowBelow(view))),
        "Mod-Shift-Enter": guardProseMirrorCommand(cmdWhenInTable((view) => addRowAbove(view))),

        ArrowUp: guardProseMirrorCommand(cmdWhenInTable((view) => escapeTableUp(view))),
        ArrowDown: guardProseMirrorCommand(cmdWhenInTable((view) => escapeTableDown(view))),
      }),
      new Plugin<TableUIPluginState>({
        key: tiptapTableUIPluginKey,
        state: {
          init: () => ({ contextMenu: null }),
          apply: (tr, value) => {
            const meta = tr.getMeta(tiptapTableUIPluginKey);
            if (meta) return { ...value, ...meta };
            return value;
          },
        },
        view(editorView) {
          return new TiptapTableUIPluginView(editorView as unknown as EditorView);
        },
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              if (!isInTable(view as unknown as EditorView)) return false;
              event.preventDefault();

              const pluginState = tiptapTableUIPluginKey.getState(view.state);
              pluginState?.contextMenu?.show(event.clientX, event.clientY);
              return true;
            },
          },
        },
      }),
    ];
  },
});
