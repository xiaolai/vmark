import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { CellSelection } from "@tiptap/pm/tables";
import { addColLeft, addColRight, addRowAbove, addRowBelow, alignColumn } from "@/plugins/tableUI/tableActions.tiptap";
import { isWindowFocused } from "@/utils/windowFocus";

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

      const unlistenInsertTable = await listen("menu:insert-table", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
      });
      if (cancelled) {
        unlistenInsertTable();
        return;
      }
      unlistenRefs.current.push(unlistenInsertTable);

      const unlistenAddRowBefore = await listen("menu:add-row-before", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        addRowAbove(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenAddRowBefore();
        return;
      }
      unlistenRefs.current.push(unlistenAddRowBefore);

      const unlistenAddRowAfter = await listen("menu:add-row-after", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        addRowBelow(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenAddRowAfter();
        return;
      }
      unlistenRefs.current.push(unlistenAddRowAfter);

      const unlistenAddColBefore = await listen("menu:add-col-before", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        addColLeft(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenAddColBefore();
        return;
      }
      unlistenRefs.current.push(unlistenAddColBefore);

      const unlistenAddColAfter = await listen("menu:add-col-after", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        addColRight(editor.view as unknown as EditorView);
      });
      if (cancelled) {
        unlistenAddColAfter();
        return;
      }
      unlistenRefs.current.push(unlistenAddColAfter);

      const unlistenDeleteCells = await listen("menu:delete-selected-cells", async () => {
        if (!(await isWindowFocused())) return;
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

      const unlistenAlignLeft = await listen("menu:align-left", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "left", false);
      });
      if (cancelled) {
        unlistenAlignLeft();
        return;
      }
      unlistenRefs.current.push(unlistenAlignLeft);

      const unlistenAlignCenter = await listen("menu:align-center", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "center", false);
      });
      if (cancelled) {
        unlistenAlignCenter();
        return;
      }
      unlistenRefs.current.push(unlistenAlignCenter);

      const unlistenAlignRight = await listen("menu:align-right", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;
        alignColumn(editor.view as unknown as EditorView, "right", false);
      });
      if (cancelled) {
        unlistenAlignRight();
        return;
      }
      unlistenRefs.current.push(unlistenAlignRight);
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
