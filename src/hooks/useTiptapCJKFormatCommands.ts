import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { collapseNewlines, formatMarkdown, formatSelection, removeTrailingSpaces } from "@/lib/cjkFormatter";
import { getWindowLabel, isWindowFocused } from "@/utils/windowFocus";

function getActiveTabIdForCurrentWindow(): string | null {
  try {
    const windowLabel = getWindowLabel();
    return useTabStore.getState().activeTabId[windowLabel] ?? null;
  } catch {
    return null;
  }
}

function getActiveMarkdown(): string {
  const tabId = getActiveTabIdForCurrentWindow();
  if (!tabId) return "";
  return useDocumentStore.getState().getDocument(tabId)?.content ?? "";
}

function setActiveMarkdown(markdown: string) {
  const tabId = getActiveTabIdForCurrentWindow();
  if (!tabId) return;
  useDocumentStore.getState().setContent(tabId, markdown);
}

export function useTiptapCJKFormatCommands(editor: TiptapEditor | null) {
  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      const unlistenFormatCJK = await listen("menu:format-cjk", async () => {
        if (!(await isWindowFocused())) return;
        const config = useSettingsStore.getState().cjkFormatting;

        const editor = editorRef.current;
        if (editor && !editor.state.selection.empty) {
          const view = editor.view;
          const { state, dispatch } = view;
          const { from, to } = state.selection;
          const selectedText = state.doc.textBetween(from, to, "\n");
          const formatted = formatSelection(selectedText, config);
          if (formatted !== selectedText) {
            dispatch(state.tr.replaceWith(from, to, state.schema.text(formatted)));
            view.focus();
          }
          return;
        }

        const content = getActiveMarkdown();
        const formatted = formatMarkdown(content, config);
        if (formatted !== content) {
          setActiveMarkdown(formatted);
        }
      });
      if (cancelled) {
        unlistenFormatCJK();
        return;
      }
      unlistenRefs.current.push(unlistenFormatCJK);

      const unlistenFormatFile = await listen("menu:format-cjk-file", async () => {
        if (!(await isWindowFocused())) return;
        const config = useSettingsStore.getState().cjkFormatting;
        const content = getActiveMarkdown();
        const formatted = formatMarkdown(content, config);
        if (formatted !== content) {
          setActiveMarkdown(formatted);
        }
      });
      if (cancelled) {
        unlistenFormatFile();
        return;
      }
      unlistenRefs.current.push(unlistenFormatFile);

      const unlistenTrailingSpaces = await listen("menu:remove-trailing-spaces", async () => {
        if (!(await isWindowFocused())) return;
        const content = getActiveMarkdown();
        const formatted = removeTrailingSpaces(content);
        if (formatted !== content) {
          setActiveMarkdown(formatted);
        }
      });
      if (cancelled) {
        unlistenTrailingSpaces();
        return;
      }
      unlistenRefs.current.push(unlistenTrailingSpaces);

      const unlistenCollapseLines = await listen("menu:collapse-blank-lines", async () => {
        if (!(await isWindowFocused())) return;
        const content = getActiveMarkdown();
        const formatted = collapseNewlines(content);
        if (formatted !== content) {
          setActiveMarkdown(formatted);
        }
      });
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
  }, []);
}
