/**
 * Image Context Menu Hook
 *
 * Purpose: Handles actions from the image context menu — Change Image,
 *   Delete Image, Copy Image Path, and Reveal in Finder.
 *
 * Key decisions:
 *   - Change Image replaces the src attribute without removing/reinserting node
 *   - Copy path resolves to absolute path (relative → absolute via document dir)
 *   - Reveal uses Tauri's revealItemInDir for native Finder integration
 *
 * @coordinates-with imageContextMenuStore.ts — reads menu state (position, nodePos)
 * @coordinates-with useImageOperations.ts — copyImageToAssets for new images
 * @module hooks/useImageContextMenu
 */

import { useCallback } from "react";
import { open, message } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { dirname, join } from "@tauri-apps/api/path";
import { imeToast as toast } from "@/utils/imeToast";
import type { EditorView } from "@tiptap/pm/view";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { useDocumentFilePath } from "@/hooks/useDocumentState";
import { imageContextMenuWarn, imageContextMenuError } from "@/utils/debug";
import i18n from "@/i18n";

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
    imageContextMenuError("Failed to resolve image path:", error);
    return null;
  }
}

/** Hook that returns a handler for image context menu actions (change, delete, copy path, reveal in Finder). */
export function useImageContextMenu(getEditorView: GetEditorView) {
  const filePath = useDocumentFilePath();

  const handleAction = useCallback(
    async (action: string) => {
      const { imageSrc, imageNodePos } = useImageContextMenuStore.getState();
      const view = getEditorView();

      if (!view) {
        imageContextMenuWarn("No editor view available");
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
                i18n.t("dialog:unsavedDocument.message"),
                { title: i18n.t("dialog:unsavedDocument.title"), kind: "warning" }
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
              imageContextMenuWarn("No image node at position");
              return;
            }

            const tr = state.tr.setNodeMarkup(imageNodePos, null, {
              ...node.attrs,
              src: relativePath,
            });

            dispatch(tr);
          } catch (error) {
            imageContextMenuError("Failed to change image:", error);
            await message(i18n.t("dialog:toast.failedToChangeImage"), { kind: "error" });
          } finally {
            isChangingImage = false;
          }
          break;
        }

        case "delete": {
          const { state, dispatch } = view;
          const node = state.doc.nodeAt(imageNodePos);

          if (!node || (node.type.name !== "image" && node.type.name !== "block_image")) {
            imageContextMenuWarn("No image node at position");
            return;
          }

          const tr = state.tr.delete(imageNodePos, imageNodePos + node.nodeSize);
          dispatch(tr);
          break;
        }

        case "copyPath": {
          if (!filePath) {
            await message(i18n.t("dialog:unsavedDocument.messageCopyPath"), {
              kind: "warning",
            });
            return;
          }

          const absolutePath = await resolveImagePath(imageSrc, filePath);
          if (absolutePath) {
            try {
              await navigator.clipboard.writeText(absolutePath);
              toast.success(i18n.t("dialog:toast.imagePathCopied"));
            } catch (error) {
              imageContextMenuError("Failed to copy path:", error);
              await message(i18n.t("dialog:toast.failedToCopyImagePath"), { kind: "error" });
            }
          }
          break;
        }

        case "revealInFinder": {
          if (!filePath) {
            await message(i18n.t("dialog:unsavedDocument.messageReveal"), {
              kind: "warning",
            });
            return;
          }

          const absolutePath = await resolveImagePath(imageSrc, filePath);
          if (absolutePath) {
            try {
              await revealItemInDir(absolutePath);
            } catch (error) {
              imageContextMenuError("Failed to reveal in Finder:", error);
              await message(i18n.t("dialog:toast.failedToRevealImage"), {
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
