/**
 * Multi-file "changed on disk" batch resolutions.
 *
 * Purpose: the three ways to resolve a batch of external file changes —
 * reload all, keep all local, or review each — extracted from
 * `useExternalFileChanges.processBatchedChanges` so that function stays a flat
 * dispatch instead of three nested loops.
 *
 * @coordinates-with useExternalFileChanges.ts — sole caller
 * @module hooks/fileChangeBatch
 */

import { readTextFile } from "@tauri-apps/plugin-fs";
import { useDocumentStore } from "@/stores/documentStore";
import { fileOpsError } from "@/utils/debug";

/** One queued dirty change: a tab and the disk path that changed under it. */
export interface BatchChange {
  tabId: string;
  filePath: string;
}

/** Reload every changed file from disk; a failed reload marks the tab missing. */
export async function reloadAllFromDisk(
  pending: BatchChange[],
  reloadTabFromDisk: (tabId: string, filePath: string) => Promise<void>,
): Promise<void> {
  for (const { tabId, filePath } of pending) {
    try {
      await reloadTabFromDisk(tabId, filePath);
    } catch (error) {
      fileOpsError("Failed to reload file:", filePath, error);
      useDocumentStore.getState().markMissing(tabId);
    }
  }
}

/**
 * Keep every local version: mark divergent and adopt the current disk content
 * as lastDiskContent so the same external state doesn't re-prompt (#904).
 */
export async function keepAllLocal(pending: BatchChange[]): Promise<void> {
  for (const { tabId, filePath } of pending) {
    useDocumentStore.getState().markDivergent(tabId);
    try {
      const currentDisk = await readTextFile(filePath);
      useDocumentStore.getState().updateLastDiskContent(tabId, currentDisk);
    } catch (error) {
      fileOpsError("Failed to refresh lastDiskContent after Keep-all:", filePath, error);
    }
  }
}

/** Prompt individually for each changed file. */
export async function reviewEachIndividually(
  pending: BatchChange[],
  handleDirtyChange: (tabId: string, filePath: string) => Promise<void>,
): Promise<void> {
  for (const { tabId, filePath } of pending) {
    await handleDirtyChange(tabId, filePath);
  }
}
