/**
 * Window Title Hook
 *
 * Purpose: Updates the native window title based on document state — shows
 *   filename with dirty indicator (•) when enabled in settings.
 *
 * Key decisions:
 *   - Also sets document.title (without extension) for print dialog PDF filename
 *   - Empty title when showFilenameInTitlebar is disabled (macOS traffic lights only)
 *   - Reacts to filePath, isDirty, and setting changes
 *
 * @coordinates-with settingsStore.ts — reads appearance.showFilenameInTitlebar
 * @coordinates-with useDocumentState.ts — reads filePath and isDirty
 * @module hooks/useWindowTitle
 */

import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useDocumentFilePath, useDocumentIsDirty } from "./useDocumentState";
import { useSettingsStore } from "@/stores/settingsStore";
import { getFileName } from "@/utils/pathUtils";
export function useWindowTitle() {
  const filePath = useDocumentFilePath();
  const isDirty = useDocumentIsDirty();
  // Default to false for undefined (localStorage migration)
  const showFilename = useSettingsStore((state) => state.appearance.showFilenameInTitlebar ?? false);

  useEffect(() => {
    const updateTitle = async () => {
      const window = getCurrentWebviewWindow();

      // Extract filename from path or use "Untitled"
      const filename = filePath ? getFileName(filePath) || "Untitled" : "Untitled";

      // Always update document.title for print dialog PDF filename
      // Remove extension for cleaner PDF naming
      const baseName = filename.replace(/\.[^.]+$/, "");
      document.title = baseName;

      if (showFilename) {
        // Add dirty indicator for window title
        const dirtyIndicator = isDirty ? "• " : "";
        const title = `${dirtyIndicator}${filename}`;

        await window.setTitle(title);
      } else {
        // Empty titlebar when setting is off
        await window.setTitle("");
      }
    };

    updateTitle();
  }, [filePath, isDirty, showFilename]);
}
