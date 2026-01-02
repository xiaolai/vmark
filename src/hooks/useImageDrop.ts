/**
 * Hook for handling Tauri file drop events.
 *
 * - Images: Saved to assets folder and inserted into editor
 * - Markdown files: Opened in a new window
 *
 * Tauri intercepts OS file drops, so we must use Tauri's onDragDropEvent
 * instead of browser's native drag-drop events.
 */

import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { message } from "@tauri-apps/plugin-dialog";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { getWindowLabel } from "@/utils/windowFocus";
import {
  saveImageToAssets,
  isImageFile,
  getFilename,
  insertBlockImageNode,
} from "@/utils/imageUtils";

type GetEditor = () => Editor | undefined;

// Cooldown to prevent rapid dialog re-triggering
const DIALOG_COOLDOWN_MS = 1000;

// Cross-window lock via localStorage to prevent multiple windows processing same drop
// (Tauri may fire onDragDropEvent on all windows, not just drop target)
const DROP_LOCK_KEY = "vmark:drop-lock";
const DROP_LOCK_TIMEOUT_MS = 500; // Auto-release after 500ms

function tryAcquireDropLock(): boolean {
  const now = Date.now();
  const existing = localStorage.getItem(DROP_LOCK_KEY);
  if (existing) {
    const timestamp = parseInt(existing, 10);
    if (now - timestamp < DROP_LOCK_TIMEOUT_MS) {
      return false; // Lock held by another window
    }
  }
  localStorage.setItem(DROP_LOCK_KEY, now.toString());
  return true;
}

function releaseDropLock(): void {
  localStorage.removeItem(DROP_LOCK_KEY);
}

/** Check if a file is a markdown file */
function isMarkdownFile(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

/** Check if current window has a blank/empty document */
function isCurrentWindowBlank(): boolean {
  const windowLabel = getWindowLabel();
  const doc = useDocumentStore.getState().getDocument(windowLabel);
  if (!doc) return true;

  // Blank = no file path, not dirty, and empty/whitespace content
  return !doc.filePath && !doc.isDirty && (!doc.content || doc.content.trim() === "");
}

export function useImageDrop(getEditor: GetEditor) {
  const isProcessing = useRef(false);
  const lastDialogTime = useRef(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const webview = getCurrentWebview();

      unlisten = await webview.onDragDropEvent(async (event) => {
        // Only handle drop events (not hover/cancel)
        if (event.payload.type !== "drop") return;

        // Cross-window lock: Only first window to acquire lock processes the drop
        if (!tryAcquireDropLock()) {
          return; // Another window is processing this drop
        }

        // Per-instance guard (for rapid drops on same window)
        if (isProcessing.current) {
          releaseDropLock();
          return;
        }
        isProcessing.current = true;

        try {
          const allPaths = event.payload.paths;

          // Handle markdown files
          const mdPaths = allPaths.filter(isMarkdownFile);
          for (const mdPath of mdPaths) {
            try {
              if (isCurrentWindowBlank()) {
                // Load directly in current window (we're already here)
                const content = await readTextFile(mdPath);
                const windowLabel = getWindowLabel();
                useDocumentStore.getState().loadContent(windowLabel, content, mdPath);
                useRecentFilesStore.getState().addFile(mdPath);
              } else {
                // Open in new window
                await invoke("open_file_in_new_window", { path: mdPath });
              }
            } catch (error) {
              console.error("Failed to open markdown file:", mdPath, error);
            }
          }

          // Filter for image files
          const imagePaths = allPaths.filter(isImageFile);
          if (imagePaths.length === 0) {
            isProcessing.current = false;
            return;
          }

          const windowLabel = getWindowLabel();
          const doc = useDocumentStore.getState().getDocument(windowLabel);
          const documentPath = doc?.filePath;
          const editor = getEditor();

          if (!editor) {
            isProcessing.current = false;
            return;
          }

          if (!documentPath) {
            // Prevent rapid dialog re-triggering (cooldown)
            const now = Date.now();
            if (now - lastDialogTime.current < DIALOG_COOLDOWN_MS) {
              isProcessing.current = false;
              return;
            }
            lastDialogTime.current = now;

            await message(
              "Please save the document first before dropping images. " +
                "Images are stored relative to the document location.",
              { title: "Unsaved Document", kind: "warning" }
            );
            isProcessing.current = false;
            return;
          }

          // Process each image
          for (const imagePath of imagePaths) {
            try {
              // Read the file
              const imageData = await readFile(imagePath);
              const filename = getFilename(imagePath);

              // Save to assets folder
              const relativePath = await saveImageToAssets(
                imageData,
                filename,
                documentPath
              );

              // Insert block image at cursor position (default for dropped images)
              editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                insertBlockImageNode(view, relativePath);
              });
            } catch (error) {
              console.error("Failed to process dropped image:", imagePath, error);
            }
          }
        } catch (error) {
          console.error("Failed to handle drop event:", error);
          await message("Failed to process dropped images.", { kind: "error" });
        } finally {
          isProcessing.current = false;
          releaseDropLock();
        }
      });
    };

    setup();

    return () => {
      unlisten?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
