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

      const unlistenInsertTable = await currentWindow.listen<string>("menu:insert-table", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
      });
      if (cancelled) {
        unlistenInsertTable();
        return;
      }
      unlistenRefs.current.push(unlistenInsertTable);

      const unlistenAddRowBefore = await currentWindow.listen<string>("menu:add-row-before", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        addRowAbove(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenAddRowBefore();
        return;
      }
      unlistenRefs.current.push(unlistenAddRowBefore);

      const unlistenAddRowAfter = await currentWindow.listen<string>("menu:add-row-after", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        addRowBelow(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenAddRowAfter();
        return;
      }
      unlistenRefs.current.push(unlistenAddRowAfter);

      const unlistenAddColBefore = await currentWindow.listen<string>("menu:add-col-before", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        addColLeft(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenAddColBefore();
        return;
      }
      unlistenRefs.current.push(unlistenAddColBefore);

      const unlistenAddColAfter = await currentWindow.listen<string>("menu:add-col-after", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        addColRight(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenAddColAfter();
        return;
      }
      unlistenRefs.current.push(unlistenAddColAfter);

      const unlistenDeleteCells = await currentWindow.listen<string>("menu:delete-selected-cells", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view as unknown as EditorView;
        if (clearSelectedCells(view)) return;
        if (!view.state.selection.empty) {
          view.dispatch(view.state.tr.deleteSelection());
          view.focus();
        }
      });
      if (cancelled) {
        unlistenDeleteCells();
        return;
      }
      unlistenRefs.current.push(unlistenDeleteCells);

      const unlistenAlignLeft = await currentWindow.listen<string>("menu:align-left", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "left", false);
      });
      if (cancelled) {
        unlistenAlignLeft();
        return;
      }
      unlistenRefs.current.push(unlistenAlignLeft);

      const unlistenAlignCenter = await currentWindow.listen<string>("menu:align-center", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "center", false);
      });
      if (cancelled) {
        unlistenAlignCenter();
        return;
      }
      unlistenRefs.current.push(unlistenAlignCenter);

      const unlistenAlignRight = await currentWindow.listen<string>("menu:align-right", (event) => {
        if (event.payload !== windowLabel) return;
          if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "right", false);
      });
      if (cancelled) {
        unlistenAlignRight();
        return;
      }
      unlistenRefs.current.push(unlistenAlignRight);

      const unlistenFormatTable = await currentWindow.listen<string>("menu:format-table", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        formatTable(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenFormatTable();
        return;
      }
      unlistenRefs.current.push(unlistenFormatTable);

      const unlistenDeleteRow = await currentWindow.listen<string>("menu:delete-row", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        deleteCurrentRow(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenDeleteRow();
        return;
      }
      unlistenRefs.current.push(unlistenDeleteRow);

      const unlistenDeleteCol = await currentWindow.listen<string>("menu:delete-col", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        deleteCurrentColumn(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenDeleteCol();
        return;
      }
      unlistenRefs.current.push(unlistenDeleteCol);

      const unlistenDeleteTable = await currentWindow.listen<string>("menu:delete-table", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        deleteCurrentTable(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenDeleteTable();
        return;
      }
      unlistenRefs.current.push(unlistenDeleteTable);

      const unlistenAlignAllLeft = await currentWindow.listen<string>("menu:align-all-left", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "left", true);
      });
      if (cancelled) {
        unlistenAlignAllLeft();
        return;
      }
      unlistenRefs.current.push(unlistenAlignAllLeft);

      const unlistenAlignAllCenter = await currentWindow.listen<string>("menu:align-all-center", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "center", true);
      });
      if (cancelled) {
        unlistenAlignAllCenter();
        return;
      }
      unlistenRefs.current.push(unlistenAlignAllCenter);

      const unlistenAlignAllRight = await currentWindow.listen<string>("menu:align-all-right", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "right", true);
      });
      if (cancelled) {
        unlistenAlignAllRight();
        return;
      }
      unlistenRefs.current.push(unlistenAlignAllRight);
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
