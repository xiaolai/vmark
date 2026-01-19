/**
 * Hook for handling image drag-and-drop in the editor
 *
 * Listens to Tauri's drag-drop events and inserts dropped images
 * into the active editor (WYSIWYG or Source mode).
 *
 * @module hooks/useImageDragDrop
 */

import { useEffect, useRef, useCallback, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readFile } from "@tauri-apps/plugin-fs";
import type { Editor } from "@tiptap/core";
import type { EditorView as CMEditorView } from "@codemirror/view";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useDropZoneStore } from "@/stores/dropZoneStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { saveImageToAssets } from "@/hooks/useImageOperations";
import { hasImageExtension } from "@/utils/imagePathDetection";
import { getFilename } from "@/utils/imageUtils";
import { message } from "@tauri-apps/plugin-dialog";

/**
 * Filter paths to only include image files.
 */
function filterImagePaths(paths: string[] | null | undefined): string[] {
  if (!paths || !Array.isArray(paths)) {
    return [];
  }
  return paths.filter(hasImageExtension);
}

/**
 * Generate unique filename for dropped images.
 */
function generateDroppedImageFilename(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "png";
  const baseName = originalName.includes(".")
    ? originalName.slice(0, originalName.lastIndexOf("."))
    : originalName;
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  return `${baseName}-${timestamp}-${random}.${ext}`;
}

interface UseImageDragDropOptions {
  /** TipTap editor instance (for WYSIWYG mode) */
  tiptapEditor?: Editor | null;
  /** CodeMirror view ref (for Source mode) */
  cmViewRef?: RefObject<CMEditorView | null>;
  /** Whether the editor is in source mode */
  isSourceMode: boolean;
  /** Whether to enable this hook */
  enabled?: boolean;
}

/**
 * Hook to handle image drag-and-drop from Finder/Explorer into the editor.
 *
 * When image files are dropped onto the editor, they are copied to the
 * assets folder and inserted at the current cursor position.
 */
export function useImageDragDrop({
  tiptapEditor,
  cmViewRef,
  isSourceMode,
  enabled = true,
}: UseImageDragDropOptions): void {
  const windowLabel = useWindowLabel();
  const unlistenRef = useRef<(() => void) | null>(null);

  const getFilePath = useCallback((): string | null => {
    try {
      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
      if (!tabId) return null;
      return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
    } catch {
      return null;
    }
  }, [windowLabel]);

  const insertImageInTiptap = useCallback(
    (relativePath: string) => {
      if (!tiptapEditor) return;

      const { state } = tiptapEditor;
      const blockImageType = state.schema.nodes.block_image;

      if (blockImageType) {
        tiptapEditor
          .chain()
          .focus()
          .insertContent({
            type: "block_image",
            attrs: { src: relativePath, alt: "", title: "" },
          })
          .run();
      } else {
        // Fallback to inline image
        tiptapEditor
          .chain()
          .focus()
          .setImage({ src: relativePath })
          .run();
      }
    },
    [tiptapEditor]
  );

  const insertImageInCodeMirror = useCallback(
    (relativePath: string) => {
      const cmView = cmViewRef?.current;
      if (!cmView) return;

      const { state } = cmView;
      const pos = state.selection.main.head;
      const markdown = `![](${relativePath})\n`;

      cmView.dispatch({
        changes: { from: pos, insert: markdown },
        selection: { anchor: pos + markdown.length },
      });
      cmView.focus();
    },
    [cmViewRef]
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const setupDragDrop = async () => {
      const webview = getCurrentWebview();

      const unlisten = await webview.onDragDropEvent(async (event) => {
        if (cancelled) return;

        const { type } = event.payload;

        // Handle drag leave: hide drop zone indicator
        if (type === "leave") {
          useDropZoneStore.getState().reset();
          return;
        }

        // Handle drag enter: show drop zone indicator
        // Note: "enter" event doesn't have paths in Tauri's type system
        if (type === "enter") {
          // Show generic drop zone (we can't know file types yet)
          useDropZoneStore.getState().setDragging(true, true, 1);
          return;
        }

        // Handle over: keep showing the drop zone
        if (type === "over") {
          // Keep the drop zone visible while hovering
          // (We showed it on "enter" but can't check paths in "over")
          return;
        }

        // Handle drop - only "drop" has paths
        if (type !== "drop") return;

        // Always reset drop zone on drop
        useDropZoneStore.getState().reset();

        const paths = event.payload.paths;
        const imagePaths = filterImagePaths(paths);
        const hasImages = imagePaths.length > 0;

        // No images to process
        if (!hasImages) return;

        const copyToAssets = useSettingsStore.getState().image.copyToAssets;
        const filePath = getFilePath();

        // Only require saved document when copying to assets
        if (copyToAssets && !filePath) {
          await message(
            "Please save the document first before inserting images. " +
              "Images are stored relative to the document location.",
            { title: "Unsaved Document", kind: "warning" }
          );
          return;
        }

        // Process each image
        for (const imagePath of imagePaths) {
          try {
            let insertPath: string;

            if (copyToAssets && filePath) {
              // Copy to assets folder (default behavior)
              const imageData = await readFile(imagePath);
              const originalName = getFilename(imagePath);
              const filename = generateDroppedImageFilename(originalName);
              insertPath = await saveImageToAssets(imageData, filename, filePath);
            } else {
              // Use original path directly
              insertPath = imagePath;
            }

            // Insert into editor based on mode
            if (isSourceMode) {
              insertImageInCodeMirror(insertPath);
            } else {
              insertImageInTiptap(insertPath);
            }
          } catch (error) {
            console.error("[ImageDragDrop] Failed to process image:", imagePath, error);
            await message("Failed to insert dropped image.", { kind: "error" });
          }
        }
      });

      if (cancelled) {
        unlisten();
        return;
      }

      unlistenRef.current = unlisten;
    };

    setupDragDrop();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [enabled, isSourceMode, getFilePath, insertImageInTiptap, insertImageInCodeMirror]);
}
