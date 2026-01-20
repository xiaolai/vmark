import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { CellSelection } from "@tiptap/pm/tables";
import { addColLeft, addColRight, addRowAbove, addRowBelow, alignColumn, deleteCurrentColumn, deleteCurrentRow, deleteCurrentTable, formatTable } from "@/plugins/tableUI/tableActions.tiptap";
import { isTerminalFocused } from "@/utils/focus";

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

      // Helper to reduce boilerplate for menu event listeners
      const createListener = async (
        eventName: string,
        handler: (editor: TiptapEditor) => void
      ): Promise<UnlistenFn | null> => {
        const unlisten = await currentWindow.listen<string>(eventName, (event) => {
          if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
          const editor = editorRef.current;
          if (!editor) return;
          handler(editor);
        });
        if (cancelled) {
          unlisten();
          return null;
        }
        return unlisten;
      };

      // Helper to register listener and handle cancellation
      const registerListener = async (
        eventName: string,
        handler: (editor: TiptapEditor) => void
      ): Promise<boolean> => {
        const unlisten = await createListener(eventName, handler);
        if (!unlisten) return false;
        unlistenRefs.current.push(unlisten);
        return true;
      };

      if (!(await registerListener("menu:insert-table", (editor) => {
        editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
      }))) return;

      if (!(await registerListener("menu:add-row-before", (editor) => {
        addRowAbove(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:add-row-after", (editor) => {
        addRowBelow(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:add-col-before", (editor) => {
        addColLeft(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:add-col-after", (editor) => {
        addColRight(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:delete-selected-cells", (editor) => {
        const view = editor.view as unknown as EditorView;
        if (clearSelectedCells(view)) return;
        if (!view.state.selection.empty) {
          view.dispatch(view.state.tr.deleteSelection());
          view.focus();
        }
      }))) return;

      if (!(await registerListener("menu:align-left", (editor) => {
        alignColumn(editor.view as unknown as EditorView, "left", false);
      }))) return;

      if (!(await registerListener("menu:align-center", (editor) => {
        alignColumn(editor.view as unknown as EditorView, "center", false);
      }))) return;

      if (!(await registerListener("menu:align-right", (editor) => {
        alignColumn(editor.view as unknown as EditorView, "right", false);
      }))) return;

      if (!(await registerListener("menu:format-table", (editor) => {
        formatTable(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:delete-row", (editor) => {
        deleteCurrentRow(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:delete-col", (editor) => {
        deleteCurrentColumn(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:delete-table", (editor) => {
        deleteCurrentTable(editor.view as unknown as EditorView);
      }))) return;

      if (!(await registerListener("menu:align-all-left", (editor) => {
        alignColumn(editor.view as unknown as EditorView, "left", true);
      }))) return;

      if (!(await registerListener("menu:align-all-center", (editor) => {
        alignColumn(editor.view as unknown as EditorView, "center", true);
      }))) return;

      if (!(await registerListener("menu:align-all-right", (editor) => {
        alignColumn(editor.view as unknown as EditorView, "right", true);
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
