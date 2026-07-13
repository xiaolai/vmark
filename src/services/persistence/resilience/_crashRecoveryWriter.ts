/**
 * Crash Recovery Writer Hook
 *
 * Periodically snapshots all dirty documents to the recovery directory.
 * Runs every 10 seconds, skipping tabs whose content hasn't changed
 * since the last write (tracked via content hash).
 *
 * @module hooks/useCrashRecoveryWriter
 * @coordinates-with crashRecovery.ts, useCrashRecoveryCleanup.ts
 */

import { useEffect, useRef } from "react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { writeRecoverySnapshot } from "@/services/persistence/crashRecovery";
import { crashRecoveryLog } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

const WRITE_INTERVAL_MS = 10_000;

/**
 * Periodically write recovery snapshots for dirty documents.
 * Mount in DocumentWindowHooks (runs per window).
 */
export function useCrashRecoveryWriter(): void {
  const windowLabel = useWindowLabel();
  const lastWrittenRef = useRef<Map<string, WrittenSnapshot>>(new Map());
  const writingRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      void writeDirtySnapshots(
        windowLabel,
        lastWrittenRef.current,
        writingRef
      );
    }, WRITE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [windowLabel]);
}

/**
 * The persisted fields of the last snapshot written for a tab. Dedup compares
 * these by value — a lossy fingerprint (the previous 32-bit string hash) can
 * collide ("Aa" / "BB" hash identically under the classic 31-multiplier), which
 * would silently keep a STALE recovery snapshot for a document that changed.
 * Holding the content string costs nothing while it is unchanged: it is the
 * very string the document store already holds.
 */
interface WrittenSnapshot {
  content: string;
  filePath: string | null;
  title: string;
}

/** True when the snapshot on disk already matches what we would write now. */
function isUnchanged(previous: WrittenSnapshot | undefined, next: WrittenSnapshot): boolean {
  return (
    previous !== undefined
    && previous.content === next.content
    && previous.filePath === next.filePath
    && previous.title === next.title
  );
}

async function writeDirtySnapshots(
  windowLabel: string,
  lastWritten: Map<string, WrittenSnapshot>,
  writingRef: React.RefObject<boolean>
): Promise<void> {
  // In-flight guard — skip if previous write pass is still running
  if (writingRef.current) return;
  writingRef.current = true;

  try {
    const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
    const docStore = useDocumentStore.getState();

    // Prune cache entries for tabs that no longer exist
    const currentTabIds = new Set(tabs.map((t) => t.id));
    for (const key of lastWritten.keys()) {
      if (!currentTabIds.has(key)) lastWritten.delete(key);
    }

    for (const tab of tabs) {
      // Browser tabs (R1) have no editable document to crash-recover.
      if (tab.kind !== "document") continue;
      const doc = docStore.getDocument(tab.id);
      if (!doc || !doc.isDirty) continue;

      const snapshot: WrittenSnapshot = {
        content: doc.content,
        filePath: tab.filePath,
        title: tab.title,
      };
      if (isUnchanged(lastWritten.get(tab.id), snapshot)) continue;

      // Per-tab isolation: one failing snapshot must never starve the tabs
      // behind it in this pass.
      const success = await writeRecoverySnapshot({
        version: 1,
        tabId: tab.id,
        windowLabel,
        ...snapshot,
        timestamp: Date.now(),
      }).catch((error: unknown) => {
        crashRecoveryLog("Snapshot write failed for", tab.id, errorMessage(error));
        return false;
      });

      // Only cache on success — failed writes will be retried next interval
      if (success) {
        lastWritten.set(tab.id, snapshot);
      }
    }
  } catch (error) {
    crashRecoveryLog(
      "Writer error:",
      /* v8 ignore next -- defensive: errors from Tauri invoke are always Error instances */
      errorMessage(error)
    );
  } finally {
    writingRef.current = false;
  }
}
