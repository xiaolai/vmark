/**
 * Crash Recovery Startup Hook
 *
 * Runs once on the main window after hot exit restore completes.
 * Scans for recovery snapshots, restores them as dirty tabs,
 * and shows a toast notification.
 *
 * @module hooks/useCrashRecoveryStartup
 * @coordinates-with crashRecovery.ts, hotExitCoordination.ts
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { waitForRestoreComplete } from "@/utils/hotExit/hotExitCoordination";
import {
  readRecoverySnapshots,
  deleteStaleRecoveryFiles,
  deleteRecoverySnapshot,
  type RecoverySnapshot,
} from "@/utils/crashRecovery";
import { crashRecoveryLog } from "@/utils/debug";

/**
 * Restore documents from crash recovery snapshots on startup.
 * Mount in MainWindowHooks (main window only, after useHotExitStartup).
 */
export function useCrashRecoveryStartup(): void {
  const windowLabel = useWindowLabel();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    void runCrashRecovery(windowLabel);
  }, [windowLabel]);
}

async function runCrashRecovery(windowLabel: string): Promise<void> {
  try {
    // Wait for hot exit to finish first
    const completed = await waitForRestoreComplete();
    if (!completed) {
      crashRecoveryLog("Hot exit restore timed out — proceeding with recovery anyway");
    }

    // Clean up old snapshots
    await deleteStaleRecoveryFiles(7);

    // Read remaining snapshots
    const snapshots = await readRecoverySnapshots();
    if (snapshots.length === 0) {
      crashRecoveryLog("No recovery snapshots found");
      return;
    }

    // Deduplicate by filePath — keep the newest snapshot for each path
    const deduped = deduplicateSnapshots(snapshots);
    crashRecoveryLog(`Found ${deduped.length} recovery snapshot(s)`);

    let restoredCount = 0;

    for (const snapshot of deduped) {
      try {
        restoreSnapshot(windowLabel, snapshot);
        restoredCount++;

        // Delete the recovery file after successful restore
        await deleteRecoverySnapshot(snapshot.tabId);
      } catch (error) {
        crashRecoveryLog(
          "Failed to restore snapshot:",
          snapshot.tabId,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Delete any snapshots that were dropped as duplicates
    for (const snapshot of snapshots) {
      if (!deduped.includes(snapshot)) {
        await deleteRecoverySnapshot(snapshot.tabId);
      }
    }

    if (restoredCount > 0) {
      toast.info(
        `Recovered ${restoredCount} document(s) from unexpected exit`
      );
      crashRecoveryLog(`Restored ${restoredCount} document(s)`);
    }
  } catch (error) {
    crashRecoveryLog(
      "Crash recovery failed:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Deduplicate snapshots by filePath, keeping the newest for each path.
 * Untitled documents (filePath === null) are never deduplicated.
 */
function deduplicateSnapshots(
  snapshots: RecoverySnapshot[]
): RecoverySnapshot[] {
  const byPath = new Map<string, RecoverySnapshot>();
  const untitled: RecoverySnapshot[] = [];

  for (const snap of snapshots) {
    if (snap.filePath === null) {
      untitled.push(snap);
      continue;
    }
    const existing = byPath.get(snap.filePath);
    if (!existing || snap.timestamp > existing.timestamp) {
      byPath.set(snap.filePath, snap);
    }
  }

  return [...untitled, ...byPath.values()];
}

/**
 * Restore a single snapshot as a new dirty tab.
 * Uses createTab (null path) then sets filePath via initDocument
 * to avoid createTab's path deduplication merging with hot-exit restored tabs.
 */
function restoreSnapshot(
  windowLabel: string,
  snapshot: RecoverySnapshot
): void {
  // Always create as untitled to bypass filePath dedup, then set filePath in doc
  const tabId = useTabStore.getState().createTab(windowLabel, null);

  // Update tab title to match the original
  if (snapshot.filePath) {
    useTabStore.getState().updateTabPath(tabId, snapshot.filePath);
  }

  // Initialize document with recovered content, marked dirty
  // savedContent = "" ensures isDirty = true (content !== savedContent)
  useDocumentStore.getState().initDocument(
    tabId,
    snapshot.content,
    snapshot.filePath,
    "" // savedContent — makes it dirty
  );
}
