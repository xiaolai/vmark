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

// ---------------------------------------------------------------------------
// Pure formatting functions — exported for testing, no DOM access
// ---------------------------------------------------------------------------

/** Format the native window title from document state. Pure — no DOM access. */
export function formatWindowTitle(
  filePath: string | null | undefined,
  isDirty: boolean,
  showFilename: boolean
): string {
  if (!showFilename) return "";
  const filename = filePath ? getFileName(filePath) || "Untitled" : "Untitled";
  const dirtyIndicator = isDirty ? "• " : "";
  return `${dirtyIndicator}${filename}`;
}

/** Format the document.title for print dialog PDF naming. Pure — no DOM access. */
export function formatDocumentTitle(filePath: string | null | undefined): string {
  const filename = filePath ? getFileName(filePath) || "Untitled" : "Untitled";
  // Remove extension for cleaner PDF naming, but keep dotfiles intact
  return filename.replace(/(?<=.)\.[^.]+$/, "");
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Hook that updates the native window title with the filename and dirty indicator based on settings. */
export function useWindowTitle() {
  const filePath = useDocumentFilePath();
  const isDirty = useDocumentIsDirty();
  // Default to false for undefined (localStorage migration)
  const showFilename = useSettingsStore((state) => state.appearance.showFilenameInTitlebar ?? false);

  useEffect(() => {
    const updateTitle = async () => {
      const window = getCurrentWebviewWindow();

      document.title = formatDocumentTitle(filePath);

      const title = formatWindowTitle(filePath, isDirty, showFilename);
      await window.setTitle(title);
    };

    updateTitle();
  }, [filePath, isDirty, showFilename]);
}
