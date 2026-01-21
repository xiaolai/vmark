import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { CellSelection } from "@tiptap/pm/tables";
import { addColLeft, addColRight, addRowAbove, addRowBelow, alignColumn, deleteCurrentColumn, deleteCurrentRow, deleteCurrentTable, formatTable } from "@/plugins/tableUI/tableActions.tiptap";
import { getEditorView } from "@/types/tiptap";
import { registerMenuListener } from "@/utils/menuListenerHelper";

function clearSelectedCells(view: EditorView): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof CellSelection)) return false;

  const paragraphType = view.state.schema.nodes.paragraph;
  if (!paragraphType) return false;

  const cells: Array<{ pos: number; node: PMNode }> = [];
  selection.forEachCell((node, pos) => {
    if (!node) return;
    cells.push({ pos, node: node as unknown as PMNode });
  });

  cells.sort((a, b) => b.pos - a.pos);

  let tr = view.state.tr;
  for (const { pos, node } of cells) {
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    tr = tr.replaceWith(from, to, paragraphType.create());
  }

  if (!tr.docChanged) return false;

  view.dispatch(tr);
  view.focus();
  return true;
}

export function useTiptapTableCommands(editor: TiptapEditor | null) {
  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;
      const cancelledRef = { current: false };

      // Update cancelledRef when cancelled changes
      const checkCancelled = () => { cancelledRef.current = cancelled; };
      checkCancelled();

      const ctx = { currentWindow, windowLabel, editorRef, unlistenRefs, cancelledRef };
      const register = (eventName: string, handler: (editor: TiptapEditor) => void) =>
        registerMenuListener(ctx, eventName, handler);

      if (!(await register("menu:insert-table", (editor) => {
        editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
      }))) return;

      if (!(await register("menu:add-row-before", (editor) => {
        addRowAbove(getEditorView(editor));
      }))) return;

      if (!(await register("menu:add-row-after", (editor) => {
        addRowBelow(getEditorView(editor));
      }))) return;

      if (!(await register("menu:add-col-before", (editor) => {
        addColLeft(getEditorView(editor));
      }))) return;

      if (!(await register("menu:add-col-after", (editor) => {
        addColRight(getEditorView(editor));
      }))) return;

      if (!(await register("menu:delete-selected-cells", (editor) => {
        const view = getEditorView(editor);
        if (clearSelectedCells(view)) return;
        if (!view.state.selection.empty) {
          view.dispatch(view.state.tr.deleteSelection());
          view.focus();
        }
      }))) return;

      if (!(await register("menu:align-left", (editor) => {
        alignColumn(getEditorView(editor), "left", false);
      }))) return;

      if (!(await register("menu:align-center", (editor) => {
        alignColumn(getEditorView(editor), "center", false);
      }))) return;

      if (!(await register("menu:align-right", (editor) => {
        alignColumn(getEditorView(editor), "right", false);
      }))) return;

      if (!(await register("menu:format-table", (editor) => {
        formatTable(getEditorView(editor));
      }))) return;

      if (!(await register("menu:delete-row", (editor) => {
        deleteCurrentRow(getEditorView(editor));
      }))) return;

      if (!(await register("menu:delete-col", (editor) => {
        deleteCurrentColumn(getEditorView(editor));
      }))) return;

      if (!(await register("menu:delete-table", (editor) => {
        deleteCurrentTable(getEditorView(editor));
      }))) return;

      if (!(await register("menu:align-all-left", (editor) => {
        alignColumn(getEditorView(editor), "left", true);
      }))) return;

      if (!(await register("menu:align-all-center", (editor) => {
        alignColumn(getEditorView(editor), "center", true);
      }))) return;

      if (!(await register("menu:align-all-right", (editor) => {
        alignColumn(getEditorView(editor), "right", true);
      }))) return;
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, []);
}
