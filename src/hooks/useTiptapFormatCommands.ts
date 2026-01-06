import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, message } from "@tauri-apps/plugin-dialog";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { copyImageToAssets, insertBlockImageNode } from "@/utils/imageUtils";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getWindowLabel, isWindowFocused } from "@/utils/windowFocus";

const INSERT_IMAGE_GUARD = "menu-insert-image";

function getActiveFilePathForCurrentWindow(): string | null {
  try {
    const windowLabel = getWindowLabel();
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

      const createMarkListener = async (eventName: string, markType: string) => {
        const unlisten = await listen(eventName, async () => {
          if (!(await isWindowFocused())) return;
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

      const unlistenImage = await listen("menu:image", async () => {
        if (!(await isWindowFocused())) return;

        const windowLabel = getWindowLabel();
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

          const filePath = getActiveFilePathForCurrentWindow();

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

      const unlistenClearFormat = await listen("menu:clear-format", async () => {
        if (!(await isWindowFocused())) return;
        const editor = editorRef.current;
        if (!editor) return;

        const view = editor.view;
        const { state, dispatch } = view;
        const { from, to } = state.selection;
        if (from === to) return;

        let tr = state.tr;
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

        if (tr.docChanged) {
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
