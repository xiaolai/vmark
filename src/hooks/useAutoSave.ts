/**
 * Auto-Save Hook
 *
 * Automatically saves the document at configurable intervals when dirty.
 * Skips untitled documents (no filePath).
 *
 * Uses saveToPath() to ensure:
 * - Consistent line ending normalization
 * - Correct pending save registration
 * - Proper history snapshots
 * - Reentry guard coordination with manual save
 */

import { useEffect, useRef } from "react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { saveToPath } from "@/utils/saveToPath";
import { isOperationInProgress } from "@/utils/reentryGuard";
import { autoSaveLog } from "@/utils/debug";

export function useAutoSave() {
  const windowLabel = useWindowLabel();
  const autoSaveEnabled = useSettingsStore((s) => s.general.autoSaveEnabled);
  const autoSaveInterval = useSettingsStore((s) => s.general.autoSaveInterval);
  const lastSaveRef = useRef<number>(0);

  useEffect(() => {
    if (!autoSaveEnabled) return;

    const intervalMs = autoSaveInterval * 1000;

    const checkAndSave = async () => {
      // Skip if manual save is in progress (prevents race condition)
      if (isOperationInProgress(windowLabel, "save")) {
        autoSaveLog("Skipping - manual save in progress");
        return;
      }

      const tabId = useTabStore.getState().activeTabId[windowLabel];
      if (!tabId) return;

      const doc = useDocumentStore.getState().getDocument(tabId);

      // Skip if no document, not dirty, no file path (untitled), or file was deleted
      if (!doc || !doc.isDirty || !doc.filePath || doc.isMissing) return;

      // Debounce: Prevent saves within 5 seconds of each other.
      // This guards against rapid successive saves when the interval
      // timer fires immediately after a manual save or content change.
      const DEBOUNCE_MS = 5000;
      const now = Date.now();
      if (now - lastSaveRef.current < DEBOUNCE_MS) return;

      // Use saveToPath for consistent normalization, pending save handling, and history
      const success = await saveToPath(tabId, doc.filePath, doc.content, "auto");

      if (success) {
        lastSaveRef.current = now;
        autoSaveLog("Saved:", doc.filePath);
      }
    };

    const interval = setInterval(checkAndSave, intervalMs);

    return () => clearInterval(interval);
  }, [windowLabel, autoSaveEnabled, autoSaveInterval]);
}
