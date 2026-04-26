/**
 * Crash Recovery Startup Hook
 *
 * Runs once on the main window after hot exit restore completes.
 * Scans for recovery snapshots, restores them as dirty tabs,
 * and shows a toast notification.
 *
 * Key decisions:
 *   - Recovery tabs are created in the background — the active tab is
 *     snapshotted before the loop and restored after, so createTab()
 *     auto-activation never steals focus from hot-exit or Finder-opened files.
 *   - Toast escalation reflects user impact: full success → info,
 *     partial → warning with counts, total failure → error so the user knows
 *     unsaved work could not be restored.
 *
 * @module hooks/useCrashRecoveryStartup
 * @coordinates-with crashRecovery.ts, hotExitCoordination.ts
 */

import { useEffect, useRef } from "react";
import { imeToast as toast } from "@/utils/imeToast";
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
import i18n from "@/i18n";

/**
 * Restore documents from crash recovery snapshots on startup.
 * Mount in MainWindowHooks (main window only, after useHotExitStartup).
 */
export function useCrashRecoveryStartup(): void {
  const windowLabel = useWindowLabel();
  const hasRun = useRef(false);

  useEffect(() => {
    /* v8 ignore start -- re-entry guard; React StrictMode double-mount makes this hard to test in isolation */
    if (hasRun.current) return;
    /* v8 ignore stop */
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

    // Snapshot the current active tab BEFORE creating recovery tabs.
    // createTab() auto-activates, which would steal focus from whatever
    // the user intended to see (e.g., a Finder-opened file that
    // useFinderFileOpen is loading concurrently).
    const prevActiveTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;

    let restoredCount = 0;
    let failedCount = 0;

    for (const snapshot of deduped) {
      try {
        restoreSnapshot(windowLabel, snapshot);
        restoredCount++;

        // Delete the recovery file after successful restore
        await deleteRecoverySnapshot(snapshot.tabId);
      } catch (error) {
        failedCount++;
        crashRecoveryLog(
          "Failed to restore snapshot:",
          snapshot.tabId,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Restore the previously active tab — recovery tabs belong in the
    // background, never stealing focus from hot-exit or Finder-opened files.
    if (restoredCount > 0 && prevActiveTabId) {
      const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
      if (tabs.some((t) => t.id === prevActiveTabId)) {
        useTabStore.getState().setActiveTab(windowLabel, prevActiveTabId);
      }
    }

    // Delete any snapshots that were dropped as duplicates
    for (const snapshot of snapshots) {
      if (!deduped.includes(snapshot)) {
        await deleteRecoverySnapshot(snapshot.tabId);
      }
    }

    const totalAttempted = deduped.length;
    if (failedCount > 0 && restoredCount > 0) {
      // Partial recovery — pin so the user can read the count breakdown
      // before deciding what to do about the unrecovered docs.
      toast.warning(
        i18n.t("dialog:toast.crashRecoveredPartial", {
          recovered: restoredCount,
          total: totalAttempted,
          failed: failedCount,
        }),
        { pin: true },
      );
      crashRecoveryLog(`Partial recovery: ${restoredCount}/${totalAttempted} (${failedCount} failed)`);
    } else if (failedCount > 0 && restoredCount === 0) {
      toast.error(i18n.t("dialog:toast.crashRecoveryFailed"), { pin: true });
      crashRecoveryLog(`Recovery failed: 0/${totalAttempted} restored`);
    } else if (restoredCount > 0) {
      toast.info(
        i18n.t("dialog:toast.crashRecoveredAll", { count: restoredCount })
      );
      crashRecoveryLog(`Restored ${restoredCount} document(s)`);
    }
  } catch (error) {
    crashRecoveryLog(
      "Crash recovery failed:",
      error instanceof Error ? error.message : String(error)
    );
    toast.error(i18n.t("dialog:toast.crashRecoveryFailed"), { pin: true });
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
