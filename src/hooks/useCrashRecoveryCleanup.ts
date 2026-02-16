/**
 * Crash Recovery Cleanup Hook
 *
 * Deletes recovery files when they are no longer needed:
 * - When a tab is closed (removed from tabStore)
 * - When a document transitions from dirty to clean (saved)
 * - When the window unloads normally (deletes only this window's tabs)
 *
 * @module hooks/useCrashRecoveryCleanup
 * @coordinates-with crashRecovery.ts, useCrashRecoveryWriter.ts
 */

import { useEffect, useRef } from "react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import {
  deleteRecoverySnapshot,
  deleteRecoveryFilesForTabs,
} from "@/utils/crashRecovery";
import { crashRecoveryLog } from "@/utils/debug";

/**
 * Clean up recovery files when tabs close, documents save, or window exits.
 * Mount in DocumentWindowHooks (runs per window).
 */
export function useCrashRecoveryCleanup(): void {
  const windowLabel = useWindowLabel();
  const prevTabIdsRef = useRef<Set<string>>(new Set());
  const prevDirtyRef = useRef<Map<string, boolean>>(new Map());

  // Tab-close cleanup: detect removed tabs and delete their recovery files
  useEffect(() => {
    const currentTabs = useTabStore.getState().getTabsByWindow(windowLabel);
    prevTabIdsRef.current = new Set(currentTabs.map((t) => t.id));

    const unsub = useTabStore.subscribe((state) => {
      const currentIds = new Set(
        state.getTabsByWindow(windowLabel).map((t) => t.id)
      );
      const prevIds = prevTabIdsRef.current;

      for (const id of prevIds) {
        if (!currentIds.has(id)) {
          crashRecoveryLog("Tab closed, deleting snapshot:", id);
          void deleteRecoverySnapshot(id);
        }
      }

      prevTabIdsRef.current = currentIds;
    });

    return () => unsub();
  }, [windowLabel]);

  // Save cleanup: detect dirty → clean transitions
  useEffect(() => {
    const docs = useDocumentStore.getState().documents;
    for (const [tabId, doc] of Object.entries(docs)) {
      prevDirtyRef.current.set(tabId, doc.isDirty);
    }

    const unsub = useDocumentStore.subscribe((state) => {
      const currentDocIds = new Set(Object.keys(state.documents));

      for (const [tabId, doc] of Object.entries(state.documents)) {
        const wasDirty = prevDirtyRef.current.get(tabId);
        if (wasDirty === true && !doc.isDirty) {
          crashRecoveryLog("Document saved, deleting snapshot:", tabId);
          void deleteRecoverySnapshot(tabId);
        }
        prevDirtyRef.current.set(tabId, doc.isDirty);
      }

      // Prune tracking for removed documents
      for (const key of prevDirtyRef.current.keys()) {
        if (!currentDocIds.has(key)) prevDirtyRef.current.delete(key);
      }
    });

    return () => unsub();
  }, []);

  // Normal-exit cleanup: delete only this window's tabs (not all windows)
  useEffect(() => {
    const handleBeforeUnload = () => {
      const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
      const tabIds = tabs.map((t) => t.id);
      void deleteRecoveryFilesForTabs(tabIds);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [windowLabel]);
}
