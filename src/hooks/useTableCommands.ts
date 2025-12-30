import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { callCommand } from "@milkdown/kit/utils";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  insertTableCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  deleteSelectedCellsCommand,
  setAlignCommand,
} from "@milkdown/kit/preset/gfm";
import type { Editor } from "@milkdown/kit/core";
import { isWindowFocused } from "@/utils/windowFocus";

type GetEditor = () => Editor | undefined;

// Helper to ensure editor has focus before executing commands
function ensureFocusAndExecute(editor: Editor, callback: () => void) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (view && !view.hasFocus()) {
      view.focus();
    }
  });
  callback();
}

export function useTableCommands(getEditor: GetEditor) {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Insert Table
      const unlistenInsertTable = await listen("menu:insert-table", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          ensureFocusAndExecute(editor, () => {
            editor.action(callCommand(insertTableCommand.key, { row: 3, col: 3 }));
          });
        }
      });
      if (cancelled) { unlistenInsertTable(); return; }
      unlistenRefs.current.push(unlistenInsertTable);

      // Add Row Before
      const unlistenAddRowBefore = await listen("menu:add-row-before", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(addRowBeforeCommand.key));
        }
      });
      if (cancelled) { unlistenAddRowBefore(); return; }
      unlistenRefs.current.push(unlistenAddRowBefore);

      // Add Row After
      const unlistenAddRowAfter = await listen("menu:add-row-after", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(addRowAfterCommand.key));
        }
      });
      if (cancelled) { unlistenAddRowAfter(); return; }
      unlistenRefs.current.push(unlistenAddRowAfter);

      // Add Column Before
      const unlistenAddColBefore = await listen("menu:add-col-before", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(addColBeforeCommand.key));
        }
      });
      if (cancelled) { unlistenAddColBefore(); return; }
      unlistenRefs.current.push(unlistenAddColBefore);

      // Add Column After
      const unlistenAddColAfter = await listen("menu:add-col-after", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(addColAfterCommand.key));
        }
      });
      if (cancelled) { unlistenAddColAfter(); return; }
      unlistenRefs.current.push(unlistenAddColAfter);

      // Delete Selected Cells
      const unlistenDeleteCells = await listen("menu:delete-selected-cells", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(deleteSelectedCellsCommand.key));
        }
      });
      if (cancelled) { unlistenDeleteCells(); return; }
      unlistenRefs.current.push(unlistenDeleteCells);

      // Align Left
      const unlistenAlignLeft = await listen("menu:align-left", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(setAlignCommand.key, "left"));
        }
      });
      if (cancelled) { unlistenAlignLeft(); return; }
      unlistenRefs.current.push(unlistenAlignLeft);

      // Align Center
      const unlistenAlignCenter = await listen("menu:align-center", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(setAlignCommand.key, "center"));
        }
      });
      if (cancelled) { unlistenAlignCenter(); return; }
      unlistenRefs.current.push(unlistenAlignCenter);

      // Align Right
      const unlistenAlignRight = await listen("menu:align-right", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action(callCommand(setAlignCommand.key, "right"));
        }
      });
      if (cancelled) { unlistenAlignRight(); return; }
      unlistenRefs.current.push(unlistenAlignRight);
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
