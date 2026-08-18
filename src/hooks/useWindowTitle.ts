/**
 * Window Title Hook
 *
 * Purpose: Updates the native window title based on document state — shows
 *   filename with dirty indicator (•).
 *
 * Key decisions:
 *   - Also sets document.title (without extension) for print dialog PDF filename
 *   - The `showFilenameInTitlebar` setting applies ONLY where the app overlays
 *     the native title bar (macOS). There, the native title text is hidden, the
 *     setting governs the app's own chrome strip, and an empty native title
 *     keeps the name out of the Window menu too. Everywhere else the native
 *     title bar is visible and is the only place a filename can appear, so
 *     showing it is not a preference — clearing it just left the window blank
 *     (#1296).
 *   - The unsaved-document fallback label is passed IN, so it can be
 *     translated: off macOS it is on screen for every unsaved document.
 *   - Reacts to filePath, isDirty, and setting changes
 *
 * @coordinates-with settingsStore.ts — reads appearance.showFilenameInTitlebar
 * @coordinates-with useDocumentState.ts — reads filePath and isDirty
 * @coordinates-with utils/platform.ts — usesOverlayTitleBar decides whose title this is
 * @module hooks/useWindowTitle
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useDocumentFilePath, useDocumentIsDirty } from "./useDocumentState";
import { useSettingsStore } from "@/stores/settingsStore";
import { getFileName, getFileNameWithoutExtension } from "@/utils/pathUtils";
import { usesOverlayTitleBar } from "@/utils/platform";
import { titleBarWarn } from "@/utils/debug";

// ---------------------------------------------------------------------------
// Pure formatting functions — exported for testing, no DOM access
// ---------------------------------------------------------------------------

/** The document's display name, or the caller's label when there is no file. */
function fileNameOr(untitledLabel: string, filePath: string | null | undefined): string {
  return filePath ? getFileName(filePath) || untitledLabel : untitledLabel;
}

/** Format the native window title from document state. Pure — no DOM access. */
export function formatWindowTitle(
  filePath: string | null | undefined,
  isDirty: boolean,
  showFilename: boolean,
  untitledLabel: string
): string {
  if (!showFilename) return "";
  const dirtyIndicator = isDirty ? "• " : "";
  return `${dirtyIndicator}${fileNameOr(untitledLabel, filePath)}`;
}

/**
 * Format the document.title for print dialog PDF naming. Pure — no DOM access.
 *
 * Extension stripping goes through `pathUtils`, not a second regex: the local
 * one kept a trailing dot (`notes.` stayed `notes.`) where the shared util drops
 * it, and one of the two would have been wrong wherever they met.
 */
export function formatDocumentTitle(
  filePath: string | null | undefined,
  untitledLabel: string
): string {
  return getFileNameWithoutExtension(fileNameOr(untitledLabel, filePath));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Hook that updates the native window title with the filename and dirty indicator based on settings. */
export function useWindowTitle() {
  const { t } = useTranslation("common");
  const filePath = useDocumentFilePath();
  const isDirty = useDocumentIsDirty();
  // Default to false for undefined (localStorage migration)
  const setting = useSettingsStore((state) => state.appearance.showFilenameInTitlebar ?? false);
  // The setting speaks for the app's own chrome strip, which exists only where
  // that strip covers the native title bar. See the header note.
  const showFilename = usesOverlayTitleBar() ? setting : true;
  const untitled = t("untitled");

  useEffect(() => {
    const updateTitle = async () => {
      const window = getCurrentWebviewWindow();

      document.title = formatDocumentTitle(filePath, untitled);

      const title = formatWindowTitle(filePath, isDirty, showFilename, untitled);
      await window.setTitle(title);
    };

    void updateTitle().catch((e) => titleBarWarn("Failed to set window title:", e));
  }, [filePath, isDirty, showFilename, untitled]);
}
