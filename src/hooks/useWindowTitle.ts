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
 *   - The no-filename fallback label is passed IN, so the caller decides what
 *     a window with no filename is called. Two things are: an unsaved document
 *     (the translated "Untitled") and a window with NO document at all — the
 *     WelcomeScreen, which is the app, not a document, and says so with the
 *     product name (#1331). A null `filePath` alone cannot tell them apart, so
 *     the hook asks the tab store instead of guessing.
 *   - Reacts to filePath, isDirty, tab presence, and setting changes
 *
 * @coordinates-with settingsStore.ts — reads appearance.showFilenameInTitlebar
 * @coordinates-with useDocumentState.ts — reads filePath, isDirty, tab presence
 * @coordinates-with utils/platform.ts — usesOverlayTitleBar decides whose title this is
 * @module hooks/useWindowTitle
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useDocumentFilePath, useDocumentIsDirty, useHasActiveTab } from "./useDocumentState";
import { useSettingsStore } from "@/stores/settingsStore";
import { getFileName, getFileNameWithoutExtension } from "@/utils/pathUtils";
import { usesOverlayTitleBar } from "@/utils/platform";
import { titleBarWarn } from "@/utils/debug";
import { APP_NAME } from "@/utils/appName";

// ---------------------------------------------------------------------------
// Pure formatting functions — exported for testing, no DOM access
// ---------------------------------------------------------------------------

/** The document's display name, or the caller's label when there is no file. */
function fileNameOr(fallbackLabel: string, filePath: string | null | undefined): string {
  return filePath ? getFileName(filePath) || fallbackLabel : fallbackLabel;
}

/** Format the native window title from document state. Pure — no DOM access. */
export function formatWindowTitle(
  filePath: string | null | undefined,
  isDirty: boolean,
  showFilename: boolean,
  fallbackLabel: string
): string {
  if (!showFilename) return "";
  const dirtyIndicator = isDirty ? "• " : "";
  return `${dirtyIndicator}${fileNameOr(fallbackLabel, filePath)}`;
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
  fallbackLabel: string
): string {
  return getFileNameWithoutExtension(fileNameOr(fallbackLabel, filePath));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Hook that updates the native window title with the filename and dirty indicator based on settings. */
export function useWindowTitle() {
  const { t } = useTranslation("common");
  const filePath = useDocumentFilePath();
  const isDirty = useDocumentIsDirty();
  const hasActiveTab = useHasActiveTab();
  // Default to false for undefined (localStorage migration)
  const setting = useSettingsStore((state) => state.appearance.showFilenameInTitlebar ?? false);
  // The setting speaks for the app's own chrome strip, which exists only where
  // that strip covers the native title bar. See the header note.
  const showFilename = usesOverlayTitleBar() ? setting : true;
  // #1331 — with no tab there is no document, so the untitled label would name
  // one that does not exist. The window is the app itself; call it that. Both
  // states reach the formatter as "the label for a window with no filename",
  // and neither carries a dirty flag, because neither has a buffer to dirty.
  const fallbackLabel = hasActiveTab ? t("untitled") : APP_NAME;
  const dirty = hasActiveTab && isDirty;

  useEffect(() => {
    const updateTitle = async () => {
      const window = getCurrentWebviewWindow();

      document.title = formatDocumentTitle(filePath, fallbackLabel);

      const title = formatWindowTitle(filePath, dirty, showFilename, fallbackLabel);
      await window.setTitle(title);
    };

    void updateTitle().catch((e) => titleBarWarn("Failed to set window title:", e));
  }, [filePath, dirty, showFilename, fallbackLabel]);
}
