import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useWindowLabel } from "../contexts/WindowContext";
import { useDocumentStore } from "../stores/documentStore";
import { useRecentFilesStore } from "../stores/recentFilesStore";

/**
 * Handle window close with save confirmation dialog.
 * Listens to both:
 * - menu:close (Cmd+W) - global event, checks if this window is focused
 * - window:close-requested (traffic light) - window-specific from Rust
 */
export function useWindowClose() {
  const windowLabel = useWindowLabel();
  // Prevent re-entry during close handling (avoids duplicate dialogs)
  const isClosingRef = useRef(false);

  const handleCloseRequest = useCallback(async () => {
    // Guard against duplicate close requests
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    try {
      const doc = useDocumentStore.getState().getDocument(windowLabel);

      // If document is not dirty, just close
      if (!doc || !doc.isDirty) {
        // Remove document from store and close window
        useDocumentStore.getState().removeDocument(windowLabel);
        await invoke("close_window", { label: windowLabel });
        return;
      }

      // Show Save/Don't Save/Cancel dialog
      const { ask, message } = await import("@tauri-apps/plugin-dialog");

      const shouldSave = await ask(
        `Do you want to save changes to "${doc.filePath || "Untitled"}"?`,
        {
          title: "Unsaved Changes",
          kind: "warning",
          okLabel: "Save",
          cancelLabel: "Don't Save",
        }
      );

      if (shouldSave === null) {
        // User cancelled (closed dialog) - don't close window
        return;
      }

      if (shouldSave) {
        // Save the document
        let path = doc.filePath;
        if (!path) {
          const newPath = await save({
            filters: [{ name: "Markdown", extensions: ["md"] }],
          });
          if (!newPath) {
            // User cancelled save dialog - don't close window
            return;
          }
          path = newPath;
        }

        try {
          await writeTextFile(path, doc.content);
          useRecentFilesStore.getState().addFile(path);
        } catch (error) {
          await message(`Failed to save file: ${error}`, {
            title: "Error",
            kind: "error",
          });
          return;
        }
      }

      // Close the window
      useDocumentStore.getState().removeDocument(windowLabel);
      await invoke("close_window", { label: windowLabel });
    } catch (error) {
      console.error("Failed to close window:", error);
    } finally {
      isClosingRef.current = false;
    }
  }, [windowLabel]);

  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      // Listen to menu:close (Cmd+W) - only handle if this window is focused
      const unlistenMenu = await listen("menu:close", async () => {
        const isFocused = await currentWindow.isFocused();
        if (isFocused) {
          handleCloseRequest();
        }
      });
      unlisteners.push(unlistenMenu);

      // Listen to window:close-requested (traffic light button)
      // CRITICAL: Use window-specific listener
      const unlistenClose = await currentWindow.listen(
        "window:close-requested",
        handleCloseRequest
      );
      unlisteners.push(unlistenClose);
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [windowLabel, handleCloseRequest]);
}
