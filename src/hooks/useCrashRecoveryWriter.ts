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
import { writeRecoverySnapshot } from "@/utils/crashRecovery";
import { crashRecoveryLog } from "@/utils/debug";

const WRITE_INTERVAL_MS = 10_000;

/**
 * Periodically write recovery snapshots for dirty documents.
 * Mount in DocumentWindowHooks (runs per window).
 */
export function useCrashRecoveryWriter(): void {
  const windowLabel = useWindowLabel();
  const lastHashRef = useRef<Map<string, string>>(new Map());
  const writingRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      void writeDirtySnapshots(
        windowLabel,
        lastHashRef.current,
        writingRef
      );
    }, WRITE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [windowLabel]);
}

/**
 * Simple string hash for change detection.
 * Not cryptographic — just fast deduplication.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash.toString(36);
}

async function writeDirtySnapshots(
  windowLabel: string,
  lastHashes: Map<string, string>,
  writingRef: React.RefObject<boolean>
): Promise<void> {
  // In-flight guard — skip if previous write pass is still running
  if (writingRef.current) return;
  writingRef.current = true;

  try {
    const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
    const docStore = useDocumentStore.getState();

    // Prune hash entries for tabs that no longer exist
    const currentTabIds = new Set(tabs.map((t) => t.id));
    for (const key of lastHashes.keys()) {
      if (!currentTabIds.has(key)) lastHashes.delete(key);
    }

    for (const tab of tabs) {
      const doc = docStore.getDocument(tab.id);
      if (!doc || !doc.isDirty) continue;

      const hash = simpleHash(doc.content);
      if (lastHashes.get(tab.id) === hash) continue;

      const success = await writeRecoverySnapshot({
        version: 1,
        tabId: tab.id,
        windowLabel,
        content: doc.content,
        filePath: tab.filePath,
        title: tab.title,
        timestamp: Date.now(),
      });

      // Only cache hash on success — failed writes will be retried next interval
      if (success) {
        lastHashes.set(tab.id, hash);
      }
    }
  } catch (error) {
    crashRecoveryLog(
      "Writer error:",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    writingRef.current = false;
  }
}
