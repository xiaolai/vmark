import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, message } from "@tauri-apps/plugin-dialog";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { copyImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { withReentryGuard } from "@/utils/reentryGuard";
import { MultiSelection } from "@/plugins/multiCursor";
import { isTerminalFocused } from "@/utils/focus";

const INSERT_IMAGE_GUARD = "menu-insert-image";

function getActiveFilePathForWindow(windowLabel: string): string | null {
  try {
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch {
    return null;
  }
}

function normalizeDialogPath(path: string | string[] | null): string | null {
  if (!path) return null;
  if (Array.isArray(path)) return path[0] ?? null;
  return path;
}

export function useTiptapFormatCommands(editor: TiptapEditor | null) {
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

      const createMarkListener = async (eventName: string, markType: string) => {
        const unlisten = await currentWindow.listen<string>(eventName, (event) => {
          if (event.payload !== windowLabel) return;
          // Skip editor-scoped shortcuts when terminal has focus
          if (isTerminalFocused()) return;
          const editor = editorRef.current;
          if (!editor) return;
          editor.commands.focus();
          expandedToggleMarkTiptap(editor.view, markType);
        });
        if (cancelled) {
          unlisten();
          return null;
        }
        return unlisten;
      };

      const unlistenImage = await currentWindow.listen<string>("menu:image", async (event) => {
        if (event.payload !== windowLabel) return;
        // Skip editor-scoped shortcuts when terminal has focus
        if (isTerminalFocused()) return;

        await withReentryGuard(windowLabel, INSERT_IMAGE_GUARD, async () => {
          const editor = editorRef.current;
          if (!editor) return;

          const selected = await open({
            filters: [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
              },
            ],
          });

          const sourcePath = normalizeDialogPath(selected);
          if (!sourcePath) return;

          const filePath = getActiveFilePathForWindow(windowLabel);

          if (!filePath) {
            await message(
              "Please save the document first to copy images to assets folder.",
              { title: "Unsaved Document", kind: "warning" }
            );
            return;
          }

          const relativePath = await copyImageToAssets(sourcePath, filePath);
          insertBlockImageNode(editor.view as unknown as Parameters<typeof insertBlockImageNode>[0], relativePath);
        });
      });
      if (cancelled) {
        unlistenImage();
        return;
      }
      unlistenRefs.current.push(unlistenImage);

      const unlistenClearFormat = await currentWindow.listen<string>("menu:clear-format", (event) => {
        if (event.payload !== windowLabel) return;
        // Skip editor-scoped shortcuts when terminal has focus
        if (isTerminalFocused()) return;
        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view;
        const { state, dispatch } = view;
        const { selection } = state;
        const ranges = selection instanceof MultiSelection ? selection.ranges : [{ $from: selection.$from, $to: selection.$to }];
        let tr = state.tr;
        let applied = false;

        for (const range of ranges) {
          const from = range.$from.pos;
          const to = range.$to.pos;
          if (from === to) continue;
          applied = true;
          state.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
            if (node.isText && node.marks.length > 0) {
              node.marks.forEach((mark: PMMark) => {
                tr = tr.removeMark(
                  Math.max(from, pos),
                  Math.min(to, pos + node.nodeSize),
                  mark.type
                );
              });
            }
          });
        }

        if (applied && tr.docChanged) {
          dispatch(tr);
          view.focus();
        }
      });
      if (cancelled) {
        unlistenClearFormat();
        return;
      }
      unlistenRefs.current.push(unlistenClearFormat);

      const unlistenBold = await createMarkListener("menu:bold", "bold");
      if (unlistenBold) unlistenRefs.current.push(unlistenBold);
      if (cancelled) return;

      const unlistenItalic = await createMarkListener("menu:italic", "italic");
      if (unlistenItalic) unlistenRefs.current.push(unlistenItalic);
      if (cancelled) return;

      const unlistenStrikethrough = await createMarkListener("menu:strikethrough", "strike");
      if (unlistenStrikethrough) unlistenRefs.current.push(unlistenStrikethrough);
      if (cancelled) return;

      const unlistenCode = await createMarkListener("menu:code", "code");
      if (unlistenCode) unlistenRefs.current.push(unlistenCode);
      if (cancelled) return;

      const unlistenLink = await createMarkListener("menu:link", "link");
      if (unlistenLink) unlistenRefs.current.push(unlistenLink);
      if (cancelled) return;

      const unlistenSubscript = await createMarkListener("menu:subscript", "subscript");
      if (unlistenSubscript) unlistenRefs.current.push(unlistenSubscript);
      if (cancelled) return;

      const unlistenSuperscript = await createMarkListener("menu:superscript", "superscript");
      if (unlistenSuperscript) unlistenRefs.current.push(unlistenSuperscript);
      if (cancelled) return;

      const unlistenHighlight = await createMarkListener("menu:highlight", "highlight");
      if (unlistenHighlight) unlistenRefs.current.push(unlistenHighlight);
      if (cancelled) return;
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
