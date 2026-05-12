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
import "./table-ui.css";

interface TableUIPluginState {
  contextMenu: TiptapTableContextMenu | null;
}

/** Plugin key for accessing table UI state (context menu reference). */
export const tiptapTableUIPluginKey = new PluginKey<TableUIPluginState>("tiptapTableUI");

class TiptapTableUIPluginView {
  private contextMenu: TiptapTableContextMenu;
  private columnResize: ColumnResizeManager;
  private view: EditorView;
  // True once destroy() has run. Guards the deferred microtask below
  // against re-registering this (now-detached) instance's contextMenu
  // into plugin state — a plugin-view swap (extension reload, document
  // remount) destroys this instance while the underlying EditorView
  // stays alive, so view.isDestroyed alone is not enough.
  private destroyed = false;

  constructor(view: EditorView) {
    this.view = view;
    this.contextMenu = new TiptapTableContextMenu(view);
    this.columnResize = new ColumnResizeManager(view);

    // Defer the meta-only dispatch out of `view()` initialization. Dispatching
    // synchronously here is reentrant — PM is still inside updateStateInner →
    // updatePluginViews when this constructor runs, and the resulting nested
    // applyTransaction runs every plugin's appendTransaction against a doc
    // that may have just been emptied (Tiptap mounts with an empty
    // <paragraph> and our onCreate replaces content via setTimeout(0)). If any
    // other plugin's appendTransaction appends a step at a stored position
    // from prior state, the step blows up with "Position N outside of
    // fragment". Microtask defer puts the dispatch after mount completes and
    // the real document is in place — the contextMenu reference is only read
    // by the `contextmenu` DOM handler on user right-click, which can't fire
    // earlier than this microtask.
    queueMicrotask(() => {
      if (this.destroyed) return;
      if ((view as EditorView & { isDestroyed?: boolean }).isDestroyed) return;
      const tr = view.state.tr.setMeta(tiptapTableUIPluginKey, {
        contextMenu: this.contextMenu,
      });
      view.dispatch(tr);
    });
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
    this.destroyed = true;
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
    /* v8 ignore next -- @preserve reason: commands always receive view in real editor */
    if (!view) return false;
    /* v8 ignore next -- @preserve reason: cmdWhenInTable guards are tested via other table commands */
    if (!isInTable(view)) return false;
    return fn(view);
  };
}

/** Tiptap extension for table UI features: context menu, column resize, and cell navigation. */
export const tableUIExtension = Extension.create({
  name: "tableUI",
  priority: 1050,
  addProseMirrorPlugins() {
    const goNext = guardProseMirrorCommand(goToNextCell(1));
    const goPrev = guardProseMirrorCommand(goToNextCell(-1));

    /* v8 ignore next -- @preserve reason: addProseMirrorPlugins not called in unit tests */
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
          return new TiptapTableUIPluginView(editorView);
        },
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              if (!isInTable(view)) return false;
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
