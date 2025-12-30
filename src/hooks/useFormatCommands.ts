import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, message } from "@tauri-apps/plugin-dialog";
import { callCommand } from "@milkdown/kit/utils";
import { insertImageCommand } from "@milkdown/kit/preset/commonmark";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import type { Node, Mark } from "@milkdown/kit/prose/model";
import { useEditorStore } from "@/stores/editorStore";
import { copyImageToAssets } from "@/utils/imageUtils";
import { isWindowFocused } from "@/utils/windowFocus";

type GetEditor = () => Editor | undefined;

export function useFormatCommands(getEditor: GetEditor) {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // Insert Image - copies to assets folder
      const unlistenImage = await listen("menu:image", async () => {
        if (!(await isWindowFocused())) return;
        try {
          const sourcePath = await open({
            filters: [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
              },
            ],
          });

          if (!sourcePath) return;

          const { filePath } = useEditorStore.getState();
          const editor = getEditor();
          if (!editor) return;

          if (!filePath) {
            // Document unsaved - show warning
            await message(
              "Please save the document first to copy images to assets folder.",
              { title: "Unsaved Document", kind: "warning" }
            );
            return;
          }

          // Copy to assets folder and get relative path (portable)
          const relativePath = await copyImageToAssets(sourcePath as string, filePath);

          // Insert with relative path - imageViewPlugin will resolve for rendering
          editor.action(
            callCommand(insertImageCommand.key, {
              src: relativePath,
              alt: "",
              title: "",
            })
          );
        } catch (error) {
          console.error("Failed to insert image:", error);
          await message("Failed to insert image.", { kind: "error" });
        }
      });
      if (cancelled) { unlistenImage(); return; }
      unlistenRefs.current.push(unlistenImage);

      // Clear Format
      const unlistenClearFormat = await listen("menu:clear-format", async () => {
        if (!(await isWindowFocused())) return;
        const editor = getEditor();
        if (editor) {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            if (!view) return;
            const { state, dispatch } = view;
            const { from, to } = state.selection;
            if (from === to) return;

            let tr = state.tr;
            state.doc.nodesBetween(from, to, (node: Node, pos: number) => {
              if (node.isText && node.marks.length > 0) {
                node.marks.forEach((mark: Mark) => {
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
            }
          });
        }
      });
      if (cancelled) { unlistenClearFormat(); return; }
      unlistenRefs.current.push(unlistenClearFormat);
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
