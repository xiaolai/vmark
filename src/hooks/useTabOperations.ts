/**
 * Tab Operations (Hooks Layer)
 *
 * Purpose: Async tab lifecycle functions with side effects — close with
 *   dirty check, orphan image cleanup, and history clearing.
 *
 * Key decisions:
 *   - Lives in hooks/ (not utils/) because it has Tauri dialog + store side effects
 *   - Orphan image cleanup runs only on explicitly closed tabs (not discarded)
 *   - On macOS, closes the window when the last tab is closed (standard behavior)
 *   - On Windows/Linux, creates a new untitled tab instead of closing the window
 *   - Pure close decision logic delegated to utils/closeDecision.ts
 *   - Re-entry guard (closingTabIds) prevents duplicate save prompts when
 *     Cmd+W fires both keydown and menu:close concurrently
 *   - Pinned tabs are short-circuited with the unpin-before-closing toast
 *     BEFORE cleanup runs — tabStore.closeTab silently refuses them, so
 *     letting cleanupTabState run anyway wipes the document of a visible tab
 *   - When a workspace is open and only one tab remains, the close is gated
 *     on a confirmation prompt (skipLastTabWarning bypasses for batch closes)
 *
 * @coordinates-with closeSave.ts — promptSaveForDirtyDocument dialog
 * @coordinates-with tabStore.ts — removeTab mutations
 * @coordinates-with workspaceSession.ts — persists session before closing window
 * @coordinates-with tabCleanup.ts — cleanupTabState centralises all per-tab store cleanup
 * @module hooks/useTabOperations
 */

import { fileOpsError } from "@/utils/debug";
import { promptSaveForDirtyDocument } from "@/hooks/closeSave";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { findOrphanedImages, deleteOrphanedImages } from "@/utils/orphanAssetCleanup";
import { cleanupTabState } from "@/hooks/tabCleanup";
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";
import { createUntitledTab } from "@/services/navigation/newFile";
import { isMacPlatform } from "@/utils/shortcutMatch";
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
 * Handle empty window after last tab is closed.
 * macOS: close the window (standard macOS behavior — app stays in dock).
 * Windows/Linux: create a new untitled tab (users expect the window to persist).
 */
async function closeWindowIfEmpty(windowLabel: string): Promise<void> {
  /* v8 ignore start -- tabs[windowLabel] always exists when called after a tab close; ?? [] is defensive */
  const remaining = useTabStore.getState().tabs[windowLabel] ?? [];
  /* v8 ignore stop */
  if (remaining.length === 0) {
    if (isMacPlatform()) {
      await persistWorkspaceSession(windowLabel);
      useTabStore.getState().removeWindow(windowLabel);
      await invoke("close_window", { label: windowLabel });
    } else {
      createUntitledTab(windowLabel);
    }
  }
}

/**
 * Tabs currently being closed — prevents duplicate save prompts when Cmd+W
 * fires both keydown (useTabShortcuts) and menu:close (useWindowClose).
 */
const closingTabIds = new Set<string>();

/** Options for closeTabWithDirtyCheck. */
export interface CloseTabOptions {
  /**
   * Skip the "this is the last document in the workspace" confirmation.
   * Batch closes (Close Others / Close to Right / Close All Unpinned)
   * already represent an explicit decision to close many tabs, so we
   * don't ask again when the loop reaches the last one. The window-close
   * path doesn't call closeTabWithDirtyCheck at all (it has its own
   * dirty-prompt path), so it doesn't need this flag.
   */
  skipLastTabWarning?: boolean;
}

/**
 * Prompt the user before closing the last open document in a workspace.
 * Returns true if the close should proceed, false if the user cancelled.
 *
 * Only fires when:
 *   - This is the last tab in the window (so closing it would either
 *     close the window on macOS or replace it with a blank untitled
 *     tab on Windows/Linux), AND
 *   - A workspace is open for this window (the warning is about losing
 *     the workspace context, not about closing a free-standing window).
 */
async function confirmLastTabInWorkspace(
  windowLabel: string,
  tabId: string,
): Promise<boolean> {
  const tabs = useTabStore.getState().tabs[windowLabel] ?? [];
  const isLastTab = tabs.length === 1 && tabs[0]?.id === tabId;
  if (!isLastTab) return true;

  const isWorkspaceMode = useWorkspaceStore.getState().isWorkspaceMode;
  if (!isWorkspaceMode) return true;

  return ask(i18n.t("dialog:closeLastTab.message"), {
    title: i18n.t("dialog:closeLastTab.title"),
    kind: "warning",
    okLabel: i18n.t("dialog:closeLastTab.confirm"),
    cancelLabel: i18n.t("dialog:closeLastTab.cancel"),
  });
}

/**
 * Close a tab with dirty check. If the document has unsaved changes,
 * prompts the user to save, don't save, or cancel.
 * If the last tab is closed, the window is closed (macOS standard behavior).
 *
 * When a workspace is open and this is the last remaining tab, also
 * asks the user to confirm — closing the last doc would either close
 * the workspace window (macOS) or replace it with a blank tab (Win/Linux),
 * and miss-clicked Cmd+W on the last tab is easy to do by accident.
 *
 * Re-entrant calls for the same tabId are treated as no-ops (returns true).
 *
 * @returns true if tab was closed, false if user cancelled
 */
export async function closeTabWithDirtyCheck(
  windowLabel: string,
  tabId: string,
  options: CloseTabOptions = {},
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
    // Last-tab-in-workspace warning. Inside the try (after add()) so
    // concurrent Cmd+W calls hit the re-entry guard immediately rather
    // than both awaiting their own copy of the warning dialog. Runs
    // BEFORE the dirty prompt so a cancelled warning avoids the
    // redundant "Save changes?" dialog.
    if (!options.skipLastTabWarning) {
      const proceed = await confirmLastTabInWorkspace(windowLabel, tabId);
      if (!proceed) return false;
    }

    // If not dirty, clean up orphans and close immediately
    if (!doc.isDirty) {
      await cleanupOrphansIfEnabled(doc.filePath, doc.content);
      useTabStore.getState().closeTab(windowLabel, tabId);
      cleanupTabState(tabId);
      await closeWindowIfEmpty(windowLabel);
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
    await closeWindowIfEmpty(windowLabel);
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
    // Batch closes (Close Others / To Right / All Unpinned) already
    // represent an explicit user decision to close multiple tabs — skip
    // the per-tab last-tab-in-workspace confirmation so we don't pop a
    // surprise dialog mid-batch when the loop happens to reach the only
    // remaining tab.
    const closed = await closeTabWithDirtyCheck(windowLabel, tabId, {
      skipLastTabWarning: true,
    });
    if (!closed) {
      return false; // User cancelled - stop closing
    }
  }
  return true;
}
