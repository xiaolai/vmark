/**
 * Tab Operations (Hooks Layer)
 *
 * Purpose: Async tab lifecycle functions with side effects — close with
 *   dirty check, orphan image cleanup, and history clearing.
 *
 * Key decisions:
 *   - Lives in hooks/ (not utils/) because it has Tauri dialog + store side effects
 *   - Orphan image cleanup runs only on explicitly closed tabs (not discarded)
 *   - Creates a fresh untitled tab when closing the last tab in a window
 *   - Pure close decision logic delegated to utils/closeDecision.ts
 *
 * @coordinates-with closeSave.ts — promptSaveForDirtyDocument dialog
 * @coordinates-with tabStore.ts — removeTab, addTab mutations
 * @coordinates-with useUnifiedHistory.ts — clearDocumentHistory on close
 * @module hooks/useTabOperations
 */

import { promptSaveForDirtyDocument } from "@/hooks/closeSave";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { findOrphanedImages, deleteOrphanedImages } from "@/utils/orphanAssetCleanup";
import { clearDocumentHistory } from "@/hooks/useUnifiedHistory";
import { createUntitledTab } from "@/utils/newFile";

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
    console.error("[OrphanCleanup] Error during close cleanup:", error);
  }
}

/** Ensure window always has at least one tab after a close. */
function ensureWindowHasTab(windowLabel: string): void {
  const remaining = useTabStore.getState().tabs[windowLabel] ?? [];
  if (remaining.length === 0) {
    createUntitledTab(windowLabel);
  }
}

/**
 * Close a tab with dirty check. If the document has unsaved changes,
 * prompts the user to save, don't save, or cancel.
 * If the last tab is closed, a new untitled tab is created automatically.
 *
 * @returns true if tab was closed, false if user cancelled
 */
export async function closeTabWithDirtyCheck(
  windowLabel: string,
  tabId: string
): Promise<boolean> {
  const doc = useDocumentStore.getState().getDocument(tabId);
  const tab = useTabStore.getState().tabs[windowLabel]?.find((t) => t.id === tabId);

  // Tab or document doesn't exist - treat as already closed
  if (!doc || !tab) return true;

  // If not dirty, clean up orphans and close immediately
  if (!doc.isDirty) {
    await cleanupOrphansIfEnabled(doc.filePath, doc.content);
    useTabStore.getState().closeTab(windowLabel, tabId);
    useDocumentStore.getState().removeDocument(tabId);
    clearDocumentHistory(tabId);
    ensureWindowHasTab(windowLabel);
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
  useDocumentStore.getState().removeDocument(tabId);
  clearDocumentHistory(tabId);
  ensureWindowHasTab(windowLabel);
  return true;
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
