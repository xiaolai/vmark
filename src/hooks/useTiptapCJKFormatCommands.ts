import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { collapseNewlines, formatMarkdown, formatSelection, removeTrailingSpaces } from "@/lib/cjkFormatter";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { isTerminalFocused } from "@/utils/focus";

function getActiveTabIdForWindow(windowLabel: string): string | null {
  try {
    return useTabStore.getState().activeTabId[windowLabel] ?? null;
  } catch {
    return null;
  }
}

function getActiveMarkdown(windowLabel: string): string {
  const tabId = getActiveTabIdForWindow(windowLabel);
  if (!tabId) return "";
  return useDocumentStore.getState().getDocument(tabId)?.content ?? "";
}

function setActiveMarkdown(windowLabel: string, markdown: string) {
  const tabId = getActiveTabIdForWindow(windowLabel);
  if (!tabId) return;
  useDocumentStore.getState().setContent(tabId, markdown);
}

function shouldPreserveTwoSpaceBreaks(windowLabel: string): boolean {
  const tabId = getActiveTabIdForWindow(windowLabel);
  const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : null;
  const hardBreakStyleOnSave = useSettingsStore.getState().markdown.hardBreakStyleOnSave;
  return resolveHardBreakStyle(doc?.hardBreakStyle ?? "unknown", hardBreakStyleOnSave) === "twoSpaces";
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

      // Get current window for filtering - menu events include target window label
      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      const unlistenFormatCJK = await currentWindow.listen<string>("menu:format-cjk", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const config = useSettingsStore.getState().cjkFormatting;
        const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks(windowLabel);

        const editor = editorRef.current;
        if (editor && !editor.state.selection.empty) {
          const view = editor.view;
          const { state, dispatch } = view;
          const { from, to } = state.selection;
          const selectedText = state.doc.textBetween(from, to, "\n");
          const formatted = formatSelection(selectedText, config, { preserveTwoSpaceHardBreaks });
          if (formatted !== selectedText) {
            dispatch(state.tr.replaceWith(from, to, state.schema.text(formatted)));
            view.focus();
          }
          return;
        }

        const content = getActiveMarkdown(windowLabel);
        const formatted = formatMarkdown(content, config, { preserveTwoSpaceHardBreaks });
        if (formatted !== content) {
          setActiveMarkdown(windowLabel, formatted);
        }
      });
      if (cancelled) {
        unlistenFormatCJK();
        return;
      }
      unlistenRefs.current.push(unlistenFormatCJK);

      const unlistenFormatFile = await currentWindow.listen<string>("menu:format-cjk-file", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const config = useSettingsStore.getState().cjkFormatting;
        const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks(windowLabel);
        const content = getActiveMarkdown(windowLabel);
        const formatted = formatMarkdown(content, config, { preserveTwoSpaceHardBreaks });
        if (formatted !== content) {
          setActiveMarkdown(windowLabel, formatted);
        }
      });
      if (cancelled) {
        unlistenFormatFile();
        return;
      }
      unlistenRefs.current.push(unlistenFormatFile);

      const unlistenTrailingSpaces = await currentWindow.listen<string>("menu:remove-trailing-spaces", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const content = getActiveMarkdown(windowLabel);
        const preserveTwoSpaceHardBreaks = shouldPreserveTwoSpaceBreaks(windowLabel);
        const formatted = removeTrailingSpaces(content, { preserveTwoSpaceHardBreaks });
        if (formatted !== content) {
          setActiveMarkdown(windowLabel, formatted);
        }
      });
      if (cancelled) {
        unlistenTrailingSpaces();
        return;
      }
      unlistenRefs.current.push(unlistenTrailingSpaces);

      const unlistenCollapseLines = await currentWindow.listen<string>("menu:collapse-blank-lines", (event) => {
        if (event.payload !== windowLabel) return;
        if (isTerminalFocused()) return;
        const content = getActiveMarkdown(windowLabel);
        const formatted = collapseNewlines(content);
        if (formatted !== content) {
          setActiveMarkdown(windowLabel, formatted);
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
