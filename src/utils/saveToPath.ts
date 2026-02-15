/**
 * Save Document to Path
 *
 * Purpose: Central save logic — normalizes content (line endings, hard breaks),
 * writes to disk, updates stores, records history snapshots, and manages
 * pending save tracking for file watcher coordination.
 *
 * Key decisions:
 *   - Pending save is registered BEFORE write and cleared AFTER with 500ms delay
 *     to handle late-arriving macOS FSEvents watcher events
 *   - Line ending and hard break normalization applied on save (not in-memory)
 *     to preserve the original editing experience while writing clean files
 *   - History snapshots are fire-and-forget — failures don't block save success
 *   - Auto-save skips recent files list to avoid noise
 *
 * @coordinates-with pendingSaves.ts — content-based save tracking for watcher coordination
 * @coordinates-with linebreaks.ts — line ending and hard break normalization
 * @coordinates-with documentStore.ts — markSaved/markAutoSaved state updates
 * @coordinates-with useHistoryOperations.ts — creates version history snapshots
 * @module utils/saveToPath
 */
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { createSnapshot } from "@/hooks/useHistoryOperations";
import { buildHistorySettings } from "@/utils/historyTypes";
import {
  resolveHardBreakStyle,
  resolveLineEndingOnSave,
  normalizeHardBreaks,
  normalizeLineEndings,
} from "@/utils/linebreaks";
import { registerPendingSave, clearPendingSave } from "@/utils/pendingSaves";

export async function saveToPath(
  tabId: string,
  path: string,
  content: string,
  saveType: "manual" | "auto" = "manual"
): Promise<boolean> {
  const doc = useDocumentStore.getState().getDocument(tabId);
  const settings = useSettingsStore.getState();
  const lineEndingPref = settings.general.lineEndingsOnSave;
  const hardBreakPref = settings.markdown.hardBreakStyleOnSave;
  const targetLineEnding = resolveLineEndingOnSave(doc?.lineEnding ?? "unknown", lineEndingPref);
  const targetHardBreakStyle = resolveHardBreakStyle(
    doc?.hardBreakStyle ?? "unknown",
    hardBreakPref
  );
  const hardBreakNormalized = normalizeHardBreaks(content, targetHardBreakStyle);
  const output = normalizeLineEndings(hardBreakNormalized, targetLineEnding);

  // Register pending save with content for content-based verification
  registerPendingSave(path, output);

  try {
    await writeTextFile(path, output);
  } catch (error) {
    // CRITICAL: Always clear pending save on failure to prevent stale entries
    clearPendingSave(path);
    console.error("Failed to save file:", error);
    const message = error instanceof Error ? error.message : String(error);
    toast.error(`Failed to save: ${message}`);
    return false;
  }

  // Write succeeded - update state
  useDocumentStore.getState().setFilePath(tabId, path);
  useDocumentStore
    .getState()
    .setLineMetadata(tabId, { lineEnding: targetLineEnding, hardBreakStyle: targetHardBreakStyle });
  if (saveType === "auto") {
    useDocumentStore.getState().markAutoSaved(tabId, output);
  } else {
    useDocumentStore.getState().markSaved(tabId, output);
  }

  // Delay clearing pending save to allow late-arriving watcher events
  // to still match against our save (macOS FSEvents can batch/delay events)
  setTimeout(() => clearPendingSave(path), 500);

  // Update tab path for title sync
  useTabStore.getState().updateTabPath(tabId, path);

  // Add to recent files (skip for auto-save to avoid noise)
  if (saveType === "manual") {
    useRecentFilesStore.getState().addFile(path);
  }

  // Create history snapshot if enabled
  const { general } = useSettingsStore.getState();
  if (general.historyEnabled) {
    try {
      await createSnapshot(path, output, saveType, buildHistorySettings(general));
    } catch (historyError) {
      console.warn("[History] Failed to create snapshot:", historyError);
      // Don't fail the save operation if history fails
    }
  }

  return true;
}
