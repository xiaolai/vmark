/**
 * Image Context Menu Hook
 *
 * Handles actions from the image context menu:
 * - Change Image: Opens file picker to replace the image
 * - Delete Image: Removes the image node
 * - Copy Image Path: Copies absolute path to clipboard
 * - Reveal in Finder: Opens Finder at the image location
 */

import { useCallback } from "react";
import { open, message } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { dirname, join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import type { EditorView } from "@tiptap/pm/view";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { useDocumentFilePath } from "@/hooks/useDocumentState";

type GetEditorView = () => EditorView | null;

// Re-entry guard for change image (prevents duplicate dialogs)
let isChangingImage = false;

/**
 * Resolve a relative image path to an absolute path.
 */
async function resolveImagePath(
  imageSrc: string,
  documentPath: string
): Promise<string | null> {
  // If already absolute or URL, return as-is
  if (imageSrc.startsWith("/") || imageSrc.startsWith("http")) {
    return imageSrc;
  }

  // Resolve relative path
  try {
    const docDir = await dirname(documentPath);
    const cleanPath = imageSrc.replace(/^\.\//, "");
    return await join(docDir, cleanPath);
  } catch (error) {
    console.error("Failed to resolve image path:", error);
    return null;
  }
}

export function useImageContextMenu(getEditorView: GetEditorView) {
  const filePath = useDocumentFilePath();

  const handleAction = useCallback(
    async (action: string) => {
      const { imageSrc, imageNodePos } = useImageContextMenuStore.getState();
      const view = getEditorView();

      if (!view) {
        console.warn("[ImageContextMenu] No editor view available");
        return;
      }

      switch (action) {
        case "change": {
          if (isChangingImage) return;
          isChangingImage = true;

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

            if (!filePath) {
              await message(
                "Please save the document first to change images.",
                { title: "Unsaved Document", kind: "warning" }
              );
              return;
            }

            // Copy new image to assets folder
            const relativePath = await copyImageToAssets(
              sourcePath as string,
              filePath
            );

            // Update the image node with new src
            const { state, dispatch } = view;
            const node = state.doc.nodeAt(imageNodePos);

            if (!node || (node.type.name !== "image" && node.type.name !== "block_image")) {
              console.warn("[ImageContextMenu] No image node at position");
              return;
            }

            const tr = state.tr.setNodeMarkup(imageNodePos, null, {
              ...node.attrs,
              src: relativePath,
            });

            dispatch(tr);
          } catch (error) {
            console.error("Failed to change image:", error);
            await message("Failed to change image.", { kind: "error" });
          } finally {
            isChangingImage = false;
          }
          break;
        }

        case "delete": {
          const { state, dispatch } = view;
          const node = state.doc.nodeAt(imageNodePos);

          if (!node || (node.type.name !== "image" && node.type.name !== "block_image")) {
            console.warn("[ImageContextMenu] No image node at position");
            return;
          }

          const tr = state.tr.delete(imageNodePos, imageNodePos + node.nodeSize);
          dispatch(tr);
          break;
        }

        case "copyPath": {
          if (!filePath) {
            await message("Document must be saved to copy image path.", {
              kind: "warning",
            });
            return;
          }

          const absolutePath = await resolveImagePath(imageSrc, filePath);
          if (absolutePath) {
            try {
              await navigator.clipboard.writeText(absolutePath);
              toast.success("Image path copied to clipboard");
            } catch (error) {
              console.error("Failed to copy path:", error);
              await message("Failed to copy image path.", { kind: "error" });
            }
          }
          break;
        }

        case "revealInFinder": {
          if (!filePath) {
            await message("Document must be saved to reveal image.", {
              kind: "warning",
            });
            return;
          }

          const absolutePath = await resolveImagePath(imageSrc, filePath);
          if (absolutePath) {
            try {
              await revealItemInDir(absolutePath);
            } catch (error) {
              console.error("Failed to reveal in Finder:", error);
              await message("Failed to reveal image in Finder.", {
                kind: "error",
              });
            }
          }
          break;
        }
      }
    },
    [filePath, getEditorView]
  );

  return handleAction;
}
