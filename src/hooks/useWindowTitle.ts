/**
 * Window Title Hook
 *
 * Purpose: Updates the native window title based on document state — shows
 *   filename with dirty indicator (•), and on macOS optionally the parent folder.
 *
 * Key decisions:
 *   - Also sets document.title (without extension) for print dialog PDF filename
 *   - The native title always names the document (#1618). On macOS the title
 *     bar text is hidden by the overlay, so the title's readers are the Dock's
 *     window previews, the Window menu and Mission Control. Clearing it left a
 *     Dock preview labelled only "VMark". `showFilenameInTitlebar` governs the
 *     app's own chrome strip (TitleBar.tsx) and has no say here. Off macOS the
 *     native title bar is the only place a filename can appear (#1296).
 *   - `showFolderInWindowTitle` is macOS-only like the toggle that sets it: off
 *     macOS a synced settings file must not change the visible title bar. It
 *     tells apart windows whose files share a name, such as two README.md files.
 *   - The no-filename fallback label is passed IN, so the caller decides what
 *     a window with no filename is called. Two things are: an unsaved document
 *     (the translated "Untitled") and a window with NO document at all — the
 *     WelcomeScreen, which is the app, not a document, and says so with the
 *     product name (#1331). A null `filePath` alone cannot tell them apart, so
 *     the hook asks the tab store instead of guessing.
 *   - Reacts to filePath, isDirty, tab presence, and setting changes
 *
 * @coordinates-with settingsStore.ts — reads appearance.showFolderInWindowTitle
 * @coordinates-with useDocumentState.ts — reads filePath, isDirty, tab presence
 * @coordinates-with utils/platform.ts — usesOverlayTitleBar scopes the folder setting
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

/**
 * The name of the folder holding a file, or "" at a root or with no directory.
 *
 * POSIX only, because the folder setting is macOS-only: a backslash is a legal
 * character in a macOS folder name, so `/notes/a\b/readme.md` names `a\b`.
 * Empty and dot segments are resolved first, so `/notes//readme.md` and
 * `/notes/archive/../readme.md` both name `notes`.
 */
function parentFolderName(filePath: string): string {
  const segments: string[] = [];
  for (const segment of filePath.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment && segment !== ".") segments.push(segment);
  }
  return segments.at(-2) ?? "";
}

/** Format the native window title from document state. Pure — no DOM access. */
export function formatWindowTitle(
  filePath: string | null | undefined,
  isDirty: boolean,
  showFolder: boolean,
  fallbackLabel: string
): string {
  const dirtyIndicator = isDirty ? "• " : "";
  const folder = showFolder && filePath ? parentFolderName(filePath) : "";
  const folderPrefix = folder ? `${folder} | ` : "";
  return `${dirtyIndicator}${folderPrefix}${fileNameOr(fallbackLabel, filePath)}`;
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

/** Hook that keeps the native window title naming the document, with its dirty indicator. */
export function useWindowTitle() {
  const { t } = useTranslation("common");
  const filePath = useDocumentFilePath();
  const isDirty = useDocumentIsDirty();
  const hasActiveTab = useHasActiveTab();
  const folderSetting = useSettingsStore((state) => state.appearance.showFolderInWindowTitle);
  const showFolder = usesOverlayTitleBar() && folderSetting;
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

      const title = formatWindowTitle(filePath, dirty, showFolder, fallbackLabel);
      await window.setTitle(title);
    };

    void updateTitle().catch((e) => titleBarWarn("Failed to set window title:", e));
  }, [filePath, dirty, showFolder, fallbackLabel]);
}
