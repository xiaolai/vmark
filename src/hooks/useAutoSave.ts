/**
 * Auto-Save Hook
 *
 * Purpose: Automatically saves dirty documents at configurable intervals —
 *   skips untitled (no filePath) documents and coordinates with manual save.
 *
 * Pipeline: Interval timer fires → iterate all tabs for window → check
 *   isDirty + hasFilePath + !isDivergent → if dirty, call saveToPath() →
 *   markAutoSaved() clears dirty flag without touching savedContent (so
 *   external change detection still works)
 *
 * Key decisions:
 *   - Uses saveToPath() for consistent line ending normalization + history snapshots
 *   - Checks isOperationInProgress() to avoid conflicting with manual save
 *   - Interval restarts when autoSaveInterval setting changes
 *   - Skips save if document is currently in the middle of an operation
 *   - Reentry guard prevents overlapping save cycles on slow filesystems
 *   - Re-reads doc state per tab (not a snapshot) so content is fresh before each save
 *
 * @coordinates-with saveToPath.ts — shared save logic with line ending handling
 * @coordinates-with reentryGuard.ts — prevents concurrent save operations
 * @coordinates-with settingsStore.ts — reads autoSaveEnabled and autoSaveInterval
 * @coordinates-with wysiwygFlush.ts — flushActiveWysiwygNow ensures content is synced before save
 * @module hooks/useAutoSave
 */

import { useEffect, useRef } from "react";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { saveToPath } from "@/utils/saveToPath";
import { isOperationInProgress } from "@/utils/reentryGuard";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { autoSaveLog, saveError } from "@/utils/debug";

const MIN_INTERVAL_MS = 1000;

/** Hook that periodically saves all dirty documents in the current window at a configurable interval. */
export function useAutoSave() {
  const windowLabel = useWindowLabel();
  const autoSaveEnabled = useSettingsStore((s) => s.general.autoSaveEnabled);
  const autoSaveInterval = useSettingsStore((s) => s.general.autoSaveInterval);
  const lastSaveRef = useRef<number>(0);
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!autoSaveEnabled) return;

    // Clamp interval to a safe minimum
    const intervalMs = Math.max(
      Number.isFinite(autoSaveInterval) ? autoSaveInterval * 1000 : MIN_INTERVAL_MS,
      MIN_INTERVAL_MS
    );

    const checkAndSave = async () => {
      // Reentry guard: prevent overlapping save cycles on slow filesystems
      if (isSavingRef.current) return;

      // Skip if manual save is in progress (prevents race condition)
      if (isOperationInProgress(windowLabel, "save")) {
        autoSaveLog("Skipping - manual save in progress");
        return;
      }

      // Debounce: Prevent saves within 5 seconds of each other.
      const DEBOUNCE_MS = 5000;
      if (Date.now() - lastSaveRef.current < DEBOUNCE_MS) return;

      isSavingRef.current = true;
      try {
        // Ensure WYSIWYG content is synced to store before reading
        flushActiveWysiwygNow();

        // Iterate ALL tabs for this window — not just the active one
        const tabs = useTabStore.getState().tabs[windowLabel] ?? [];
        let anySaved = false;

        for (const tab of tabs) {
          // Re-read doc state per tab to get fresh content (avoids stale snapshot)
          const doc = useDocumentStore.getState().getDocument(tab.id);
          // Skip if no document, not dirty, no file path (untitled), file was deleted,
          // or user chose "keep my changes" after external change (divergent)
          if (!doc || !doc.isDirty || !doc.filePath || doc.isMissing || doc.isDivergent) continue;

          try {
            const success = await saveToPath(tab.id, doc.filePath, doc.content, "auto");
            if (success) {
              anySaved = true;
              autoSaveLog("Saved:", doc.filePath);
            }
          } catch (error) {
            saveError("Auto-save failed for", doc.filePath, error);
          }
        }

        if (anySaved) {
          lastSaveRef.current = Date.now();
        }
      } finally {
        isSavingRef.current = false;
      }
    };

    const interval = setInterval(checkAndSave, intervalMs);

    return () => clearInterval(interval);
  }, [windowLabel, autoSaveEnabled, autoSaveInterval]);
}
