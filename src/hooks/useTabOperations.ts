/**
 * Tab Operations (Hooks Layer)
 *
 * Purpose: Async tab lifecycle functions with side effects — close with
 *   dirty check and orphan image cleanup.
 *
 * Key decisions:
 *   - Lives in hooks/ (not utils/) because it has Tauri dialog + store side effects
 *   - Orphan image cleanup runs only on explicitly closed tabs (not discarded)
 *   - Closing the last tab does NOT close the window. The window stays open and
 *     the render layer shows the Welcome screen (empty-workspace window, like
 *     VSCode), with the workspace sidebar still visible if one is open. This is
 *     the same on every platform. The window itself is closed via the
 *     traffic-light button / Cmd+Q (handleCloseRequest in useWindowClose), or by
 *     Cmd+W when the window is already empty.
 *   - Re-entry guard (closingTabIds) prevents duplicate save prompts when
 *     Cmd+W fires both keydown and menu:close concurrently
 *   - Pinned tabs are short-circuited with the unpin-before-closing toast
 *     BEFORE cleanup runs — tabStore.closeTab silently refuses them, so
 *     letting cleanupTabState run anyway wipes the document of a visible tab
 *
 * @coordinates-with closeSave.ts — promptSaveForDirtyDocument dialog
 * @coordinates-with tabStore.ts — closeTab leaves a valid empty-window state
 * @coordinates-with tabCleanup.ts — cleanupTabState centralises all per-tab store cleanup
 * @coordinates-with paneStore.ts — handleTabClosed collapses a split when a paned tab closes (#1081)
 * @coordinates-with components/Welcome/WelcomeScreen.tsx — shown when no tab remains
 * @module hooks/useTabOperations
 */

import { fileOpsError } from "@/utils/debug";
import { promptSaveForDirtyDocument } from "@/hooks/closeSave";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { findOrphanedImages, deleteOrphanedImages } from "@/services/media/orphanAssetCleanup";
import { cleanupTabState } from "@/hooks/tabCleanup";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";

/**
 * Clean up orphaned images for a document if setting is enabled.
 * Only runs on saved documents (not discarded changes).
 */
async function cleanupOrphansIfEnabled(
  filePath: string | null,
  content: string
): Promise<void> {
  if (!filePath) return;

  const { cleanupOrphansOnClose } = useSettingsStore.getState().image;
  if (!cleanupOrphansOnClose) return;

  try {
    const result = await findOrphanedImages(filePath, content);
    if (result.orphanedImages.length > 0) {
      await deleteOrphanedImages(result.orphanedImages);
    }
  } catch (error) {
    // Silent failure - don't block close for cleanup errors
    fileOpsError("OrphanCleanup error during close cleanup:", error);
  }
}

/**
 * Tabs currently being closed — prevents duplicate save prompts when Cmd+W
 * fires both keydown (useTabShortcuts) and menu:close (useWindowClose).
 */
const closingTabIds = new Set<string>();

/**
 * Close a tab with dirty check. If the document has unsaved changes,
 * prompts the user to save, don't save, or cancel.
 *
 * Closing the last tab leaves the window open on the Welcome screen rather
 * than closing it (empty-workspace window — see the module header). The window
 * is closed elsewhere (traffic-light / Cmd+Q / Cmd+W-when-empty).
 *
 * Re-entrant calls for the same tabId are treated as no-ops (returns true).
 *
 * @returns true if tab was closed, false if user cancelled
 */
export async function closeTabWithDirtyCheck(
  windowLabel: string,
  tabId: string,
): Promise<boolean> {
  // Re-entry guard: another close for this tab is already in progress
  if (closingTabIds.has(tabId)) return true;

  const doc = useDocumentStore.getState().getDocument(tabId);
  const tab = useTabStore.getState().tabs[windowLabel]?.find((t) => t.id === tabId);

  // Tab or document doesn't exist - treat as already closed
  if (!doc || !tab) return true;

  // Pinned tabs are refused by tabStore.closeTab — but the caller path
  // here would still run cleanupTabState() and wipe the document state
  // for a tab that remains visible in the UI. Short-circuit with the
  // same toast tabStore would have shown.
  if (tab.isPinned) {
    toast.info(i18n.t("dialog:toast.unpinBeforeClosing"));
    return false;
  }

  closingTabIds.add(tabId);
  try {
    // If not dirty, clean up orphans and close immediately
    if (!doc.isDirty) {
      await cleanupOrphansIfEnabled(doc.filePath, doc.content);
      useTabStore.getState().closeTab(windowLabel, tabId);
      cleanupTabState(tabId);
      usePaneStore.getState().handleTabClosed(windowLabel, tabId); // #1081 H1
      return true;
    }

    // Prompt user for dirty document
    const result = await promptSaveForDirtyDocument({
      windowLabel,
      tabId,
      title: doc.filePath || tab.title,
      filePath: doc.filePath,
      content: doc.content,
    });

    if (result.action === "cancelled") {
      return false;
    }

    // If user saved, clean up orphans based on saved content
    // If user discarded, don't clean up (would delete based on unsaved changes)
    if (result.action === "saved") {
      // Re-fetch document content after save
      const savedDoc = useDocumentStore.getState().getDocument(tabId);
      if (savedDoc) {
        await cleanupOrphansIfEnabled(savedDoc.filePath, savedDoc.content);
      }
    }

    // Proceed to close
    useTabStore.getState().closeTab(windowLabel, tabId);
    cleanupTabState(tabId);
    return true;
  } finally {
    closingTabIds.delete(tabId);
  }
}

/**
 * Close multiple tabs with dirty checks.
 * Prompts for each dirty tab. If user cancels any, stops and returns false.
 *
 * @returns true if all tabs were closed, false if user cancelled any
 */
export async function closeTabsWithDirtyCheck(
  windowLabel: string,
  tabIds: string[]
): Promise<boolean> {
  for (const tabId of tabIds) {
    const closed = await closeTabWithDirtyCheck(windowLabel, tabId);
    if (!closed) {
      return false; // User cancelled - stop closing
    }
  }
  return true;
}
