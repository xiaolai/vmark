/**
 * Save Document to Path
 *
 * Purpose: Central save logic — normalizes content (line endings, hard breaks),
 * writes to disk, updates stores, records history snapshots, and manages
 * pending save tracking for file watcher coordination.
 *
 * Key decisions:
 *   - Pending save is registered BEFORE write and cleared AFTER with 1000ms delay
 *     to handle late-arriving macOS FSEvents watcher events (full pipeline can
 *     exceed 500ms under heavy I/O: Rust debounce + emit + JS event loop + readFile)
 *   - Line ending and hard break normalization applied on save (not in-memory)
 *     to preserve the original editing experience while writing clean files
 *   - History snapshots are fire-and-forget — failures don't block save success,
 *     but the first failure per session warns the user so silent breakage is visible
 *   - Auto-save skips recent files list AND skips error toasts to avoid spam on
 *     a flaky disk; the user didn't initiate the action and the next manual save
 *     will surface the error
 *
 * @coordinates-with pendingSaves.ts — content-based save tracking for watcher coordination
 * @coordinates-with linebreaks.ts — line ending and hard break normalization
 * @coordinates-with documentStore.ts — markSaved/markAutoSaved state updates
 * @coordinates-with useHistoryOperations.ts — creates version history snapshots
 * @module utils/saveToPath
 */
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/utils/imeToast";
import i18n from "@/i18n";
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
import { historyWarn, saveError } from "@/utils/debug";

// Tracks whether we've already warned the user about snapshot failures
// in this session — without this, every save during a broken history backend
// would spam toasts.
let snapshotWarningShown = false;

/** Test-only: reset module-level session flags. */
export function __resetSessionFlags(): void {
  snapshotWarningShown = false;
}

/**
 * Sentinel prefix returned by the Rust `atomic_write_file` command when the
 * parent directory of the target path no longer exists (renamed/deleted
 * externally). Must stay in sync with `src-tauri/src/lib.rs`.
 */
const PARENT_MISSING_PREFIX = "PARENT_MISSING:";

function parseParentMissingError(error: unknown): string | null {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : null;
  if (!message || !message.startsWith(PARENT_MISSING_PREFIX)) return null;
  return message.slice(PARENT_MISSING_PREFIX.length);
}

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

  // Register pending save with content for content-based verification.
  // Token prevents overlapping saves from clearing each other's entries.
  const saveToken = registerPendingSave(path, output);

  try {
    await invoke("atomic_write_file", { path, content: output });
  } catch (error) {
    // CRITICAL: Always clear pending save on failure to prevent stale entries.
    // Token ensures we only clear our own registration, not a newer save's.
    clearPendingSave(path, saveToken);
    saveError("Failed to save file:", error);

    // Parent directory vanished (renamed/deleted externally). Mark the doc
    // as missing so the calling Save handler routes through Save As — the
    // user can pick a new location in one click instead of staring at a
    // raw "No such file or directory" error.
    const missingDir = parseParentMissingError(error);
    if (missingDir !== null) {
      useDocumentStore.getState().markMissing(tabId);
      if (saveType === "manual") {
        toast.error(
          i18n.t("dialog:toast.failedToSaveParentMissing", { dir: missingDir }),
          { pin: true },
        );
      }
      return false;
    }

    // Manual saves toast; auto-saves stay quiet so a flaky disk doesn't pop
    // a notification every interval. The next manual save (or an external
    // signal like the file becoming missing) will surface the problem.
    if (saveType === "manual") {
      const message = error instanceof Error ? error.message : String(error);
      // Pin: failure messages can be long (system errors include paths and
      // permission details). Users may want to copy them down.
      toast.error(i18n.t("dialog:toast.failedToSaveGeneric", { error: message }), {
        pin: true,
      });
    }
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
  // to still match against our save. The full pipeline (Rust debounce 200ms →
  // emit → JS event loop → async readTextFile → comparison) can exceed 500ms
  // under heavy I/O, so use 1000ms for safety.
  setTimeout(() => clearPendingSave(path, saveToken), 1000);

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
      historyWarn("Failed to create snapshot:", historyError);
      // Don't fail the save operation if history fails — but warn the user
      // once per session so silent breakage is visible (e.g., history dir
      // permissions changed). Subsequent failures stay silent to avoid spam.
      if (!snapshotWarningShown) {
        snapshotWarningShown = true;
        toast.warning(i18n.t("dialog:toast.historySnapshotFailed"), { pin: true });
      }
    }
  }

  return true;
}
