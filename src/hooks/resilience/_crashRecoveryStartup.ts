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
import { imeToast as toast } from "@/services/ime/imeToast";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { waitForRestoreComplete } from "@/services/persistence/hotExit/hotExitCoordination";
import {
  readRecoverySnapshots,
  deleteStaleRecoveryFiles,
  deleteRecoverySnapshot,
  type RecoverySnapshot,
} from "@/services/persistence/crashRecovery";
import { crashRecoveryLog } from "@/utils/debug";
import i18n from "@/i18n";
import { errorMessage } from "@/utils/errorMessage";

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

/**
 * Restore each snapshot, keeping recovery tabs out of the user's way.
 *
 * `createTab` auto-activates, so the active tab is captured BEFORE the loop and
 * put back after — otherwise a recovery tab steals focus from whatever the user
 * meant to see, such as a Finder-opened file loading concurrently.
 */
function restoreAll(
  windowLabel: string,
  snapshots: RecoverySnapshot[],
): { restored: number; failed: number; toDelete: string[] } {
  const prevActiveTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const toDelete: string[] = [];
  let restored = 0;
  let failed = 0;

  for (const snapshot of snapshots) {
    try {
      restoreSnapshot(windowLabel, snapshot);
      restored += 1;
      toDelete.push(snapshot.tabId);
    } catch (error) {
      failed += 1;
      crashRecoveryLog("Failed to restore snapshot:", snapshot.tabId, errorMessage(error));
    }
  }

  if (restored > 0 && prevActiveTabId) {
    const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
    if (tabs.some((t) => t.id === prevActiveTabId)) {
      useTabStore.getState().setActiveTab(windowLabel, prevActiveTabId);
    }
  }

  return { restored, failed, toDelete };
}

/**
 * Tell the user what was recovered.
 *
 * Escalation tracks impact: full success is informational, a partial recovery
 * pins a warning with counts so they can see what did NOT come back, and total
 * failure is an error — unsaved work was lost and silence would hide it.
 */
function reportRecovery(restored: number, failed: number, attempted: number): void {
  if (failed > 0 && restored > 0) {
    toast.warning(
      i18n.t("dialog:toast.crashRecoveredPartial", {
        recovered: restored,
        total: attempted,
        failed,
      }),
      { pin: true },
    );
    crashRecoveryLog(`Partial recovery: ${restored}/${attempted} (${failed} failed)`);
    return;
  }
  if (failed > 0) {
    toast.error(i18n.t("dialog:toast.crashRecoveryFailed"), { pin: true });
    crashRecoveryLog(`Recovery failed: 0/${attempted} restored`);
    return;
  }
  if (restored > 0) {
    toast.info(i18n.t("dialog:toast.crashRecoveredAll", { count: restored }));
    crashRecoveryLog(`Restored ${restored} document(s)`);
  }
}

async function runCrashRecovery(windowLabel: string): Promise<void> {
  try {
    // Hot exit restore has to finish first — otherwise it clears the tabs
    // recovery just created.
    const completed = await waitForRestoreComplete();
    if (!completed) {
      crashRecoveryLog("Hot exit restore timed out — proceeding with recovery anyway");
    }

    await deleteStaleRecoveryFiles(7);

    const snapshots = await readRecoverySnapshots();
    if (snapshots.length === 0) {
      crashRecoveryLog("No recovery snapshots found");
      return;
    }

    const deduped = deduplicateSnapshots(snapshots);
    crashRecoveryLog(`Found ${deduped.length} recovery snapshot(s)`);

    const { restored, failed, toDelete } = restoreAll(windowLabel, deduped);

    // Delete the files for everything restored, plus the collapsed duplicates.
    const collapsed = snapshots.filter((s) => !deduped.includes(s)).map((s) => s.tabId);
    for (const tabId of [...toDelete, ...collapsed]) {
      await deleteRecoverySnapshot(tabId);
    }

    reportRecovery(restored, failed, deduped.length);
  } catch (error) {
    crashRecoveryLog("Crash recovery failed:", errorMessage(error));
    toast.error(i18n.t("dialog:toast.crashRecoveryFailed"), { pin: true });
  }
}

/**
 * Collapse only GENUINELY redundant snapshots — same path AND same content.
 *
 * Snapshots are written per TAB, so two tabs open on one file are two
 * snapshots with one path. Deduplicating by path alone kept the newest and
 * deleted the rest outright, discarding unsaved edits that differed — the
 * exact data this feature exists to protect, lost by the feature itself.
 *
 * Identical content is different: nothing is recoverable from the second copy
 * that the first does not already have, and restoring both would multiply tabs
 * across repeated crashes. Newest wins there, so the surviving snapshot is the
 * one whose timestamp the user would recognise.
 *
 * Untitled documents are never collapsed. They have no shared identity to
 * compare on, and two scratch buffers with the same text are still two buffers
 * the user had open.
 */
function deduplicateSnapshots(
  snapshots: RecoverySnapshot[]
): RecoverySnapshot[] {
  const byPathAndContent = new Map<string, RecoverySnapshot>();
  const untitled: RecoverySnapshot[] = [];

  for (const snap of snapshots) {
    if (snap.filePath === null) {
      untitled.push(snap);
      continue;
    }
    // NUL cannot appear in a path, so it cannot forge a collision between a
    // path ending in content and a shorter path with longer content.
    const key = `${snap.filePath}\0${snap.content}`;
    const existing = byPathAndContent.get(key);
    if (!existing || snap.timestamp > existing.timestamp) {
      byPathAndContent.set(key, snap);
    }
  }

  return [...untitled, ...byPathAndContent.values()];
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

  if (snapshot.filePath) {
    // File-backed: the PATH is the title's source of truth. `updateTabPath`
    // derives it, which also stays correct if the file was renamed on disk
    // while the app was down — the snapshot's title would be stale.
    useTabStore.getState().updateTabPath(tabId, snapshot.filePath);
  } else if (snapshot.title.trim()) {
    // Untitled: nothing derives the title, so the snapshot is the only record
    // of it. Without this the buffer came back renumbered by `createTab`'s
    // counter and the user could not tell which scratch document it was.
    useTabStore.getState().updateTabTitle(tabId, snapshot.title);
  }

  // Create empty-clean, then apply the recovered content as a crash-recovery
  // EDIT: dirty against the empty baseline (recovered work IS unsaved), with
  // the snapshot's line convention derived — this path never set metadata.
  useDocumentStore.getState().initDocument(tabId, "", snapshot.filePath, { savedContent: "" });
  useDocumentStore.getState().ingestExternalContent(tabId, snapshot.content, "crash-recovery");
}
