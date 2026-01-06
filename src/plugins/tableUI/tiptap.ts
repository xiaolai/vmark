import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Command } from "@tiptap/pm/state";
import { keymap } from "@tiptap/pm/keymap";
import type { EditorView } from "@tiptap/pm/view";
import { goToNextCell } from "@tiptap/pm/tables";
import { ColumnResizeManager } from "./columnResize";
import { TiptapTableContextMenu } from "./TiptapTableContextMenu";
import { addRowAbove, addRowBelow, deleteCurrentRow, isInTable } from "./tableActions.tiptap";

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
    if (isInTable(view)) {
      this.columnResize.scheduleUpdate();
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
    const goNext = goToNextCell(1);
    const goPrev = goToNextCell(-1);

    return [
      keymap({
        Tab: goNext,
        "Shift-Tab": goPrev,
        "Mod-Enter": cmdWhenInTable((view) => addRowBelow(view)),
        "Mod-Shift-Enter": cmdWhenInTable((view) => addRowAbove(view)),
        "Mod-Backspace": cmdWhenInTable((view) => deleteCurrentRow(view)),
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
