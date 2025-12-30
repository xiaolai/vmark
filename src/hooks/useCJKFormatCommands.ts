import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { editorViewCtx } from "@milkdown/kit/core";
import { replaceAll } from "@milkdown/kit/utils";
import type { Editor } from "@milkdown/kit/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { useEditorStore } from "@/stores/editorStore";
import {
  formatMarkdown,
  formatSelection,
  removeTrailingSpaces,
  collapseNewlines,
} from "@/lib/cjkFormatter";
import { isWindowFocused } from "@/utils/windowFocus";

type GetEditor = () => Editor | undefined;

export function useCJKFormatCommands(getEditor: GetEditor) {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Format CJK Text (selection or entire content if no selection)
      const unlistenFormatCJK = await listen("menu:format-cjk", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (!editor) return;

        const config = useSettingsStore.getState().cjkFormatting;

        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!view) return;

          const { state, dispatch } = view;
          const { from, to } = state.selection;

          // If there's a selection, format just the selection
          if (from !== to) {
            const selectedText = state.doc.textBetween(from, to, "\n");
            const formatted = formatSelection(selectedText, config);

            if (formatted !== selectedText) {
              const tr = state.tr.replaceWith(
                from,
                to,
                state.schema.text(formatted)
              );
              dispatch(tr);
            }
          } else {
            // No selection - format entire document
            const content = useEditorStore.getState().content;
            const formatted = formatMarkdown(content, config);

            if (formatted !== content) {
              // Use replaceAll to update the entire document
              editor.action(replaceAll(formatted));
            }
          }
        });
      });
      if (cancelled) {
        unlistenFormatCJK();
        return;
      }
      unlistenRefs.current.push(unlistenFormatCJK);

      // Format Entire File
      const unlistenFormatFile = await listen("menu:format-cjk-file", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (!editor) return;

        const config = useSettingsStore.getState().cjkFormatting;
        const content = useEditorStore.getState().content;
        const formatted = formatMarkdown(content, config);

        if (formatted !== content) {
          editor.action(replaceAll(formatted));
        }
      });
      if (cancelled) {
        unlistenFormatFile();
        return;
      }
      unlistenRefs.current.push(unlistenFormatFile);

      // Remove Trailing Spaces
      const unlistenTrailingSpaces = await listen(
        "menu:remove-trailing-spaces",
        async () => {
          if (!(await isWindowFocused())) return;
          const editor = getEditor();
          if (!editor) return;

          const content = useEditorStore.getState().content;
          const formatted = removeTrailingSpaces(content);

          if (formatted !== content) {
            editor.action(replaceAll(formatted));
          }
        }
      );
      if (cancelled) {
        unlistenTrailingSpaces();
        return;
      }
      unlistenRefs.current.push(unlistenTrailingSpaces);

      // Collapse Blank Lines
      const unlistenCollapseLines = await listen(
        "menu:collapse-blank-lines",
        async () => {
          if (!(await isWindowFocused())) return;
          const editor = getEditor();
          if (!editor) return;

          const content = useEditorStore.getState().content;
          const formatted = collapseNewlines(content);

          if (formatted !== content) {
            editor.action(replaceAll(formatted));
          }
        }
      );
      if (cancelled) {
        unlistenCollapseLines();
        return;
      }
      unlistenRefs.current.push(unlistenCollapseLines);
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
