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
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { createSnapshot } from "@/hooks/useHistoryOperations";
import { buildHistorySettings } from "@/utils/historyTypes";
import {
  resolveWritableFileOwnership,
  showFileOwnershipConflictToast,
} from "@/services/workspaces/fileOwnership";
import {
  resolveHardBreakStyle,
  resolveLineEndingOnSave,
  normalizeHardBreaks,
  normalizeLineEndings,
} from "@/utils/linebreaks";
import { registerPendingSave, clearPendingSave } from "@/utils/pendingSaves";
import { historyWarn, saveError } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

// Tracks whether we've already warned the user about snapshot failures
// in this session — without this, every save during a broken history backend
// would spam toasts.
let snapshotWarningShown = false;

/**
 * Test-only: reset module-level session flags.
 * @public — accessed dynamically via `("__resetSessionFlags" in mod)` in tests,
 * which static analysis (knip) cannot trace; tag prevents a false unused-export report.
 */
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

type SaveType = "manual" | "auto";

/** Normalized save payload plus the line-ending/hard-break styles applied. */
interface NormalizedSaveContent {
  output: string;
  targetLineEnding: ReturnType<typeof resolveLineEndingOnSave>;
  targetHardBreakStyle: ReturnType<typeof resolveHardBreakStyle>;
}

/**
 * Resolve the on-save line-ending and hard-break styles from the document's
 * detected state plus user settings, and apply them to produce the bytes that
 * will be written to disk.
 */
function normalizeSaveContent(tabId: string, content: string): NormalizedSaveContent {
  const doc = useDocumentStore.getState().getDocument(tabId);
  const settings = useSettingsStore.getState();
  const targetLineEnding = resolveLineEndingOnSave(
    doc?.lineEnding ?? "unknown",
    settings.general.lineEndingsOnSave
  );
  const targetHardBreakStyle = resolveHardBreakStyle(
    doc?.hardBreakStyle ?? "unknown",
    settings.markdown.hardBreakStyleOnSave
  );
  const hardBreakNormalized = normalizeHardBreaks(content, targetHardBreakStyle);
  const output = normalizeLineEndings(hardBreakNormalized, targetLineEnding);
  return { output, targetLineEnding, targetHardBreakStyle };
}

/**
 * Map a failed write to user feedback and document state, clearing the pending
 * save first. Always returns `false` — the caller propagates the save failure.
 */
function handleWriteError(
  tabId: string,
  path: string,
  saveToken: ReturnType<typeof registerPendingSave>,
  saveType: SaveType,
  error: unknown
): false {
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
    const message = errorMessage(error);
    // Pin: failure messages can be long (system errors include paths and
    // permission details). Users may want to copy them down.
    toast.error(i18n.t("dialog:toast.failedToSaveGeneric", { error: message }), {
      pin: true,
    });
  }
  return false;
}

/**
 * Update stores after a successful write: file path, line metadata, saved
 * markers, deferred pending-save clear, tab path sync, and recent files.
 */
function applyPostSaveState(
  tabId: string,
  path: string,
  normalized: NormalizedSaveContent,
  saveToken: ReturnType<typeof registerPendingSave>,
  saveType: SaveType
): void {
  const { output, targetLineEnding, targetHardBreakStyle } = normalized;
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
}

/**
 * Record a version-history snapshot if enabled. Failures never block the save —
 * but the first per session warns the user so silent breakage is visible.
 */
async function recordHistorySnapshot(
  path: string,
  output: string,
  saveType: SaveType
): Promise<void> {
  const { general } = useSettingsStore.getState();
  if (!general.historyEnabled) return;
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

export async function saveToPath(
  tabId: string,
  path: string,
  content: string,
  saveType: SaveType = "manual"
): Promise<boolean> {
  const normalized = normalizeSaveContent(tabId, content);

  const ownership = resolveWritableFileOwnership(tabId, path);
  if (!ownership.ok) {
    if (saveType === "manual") showFileOwnershipConflictToast(path, ownership.conflicts);
    return false;
  }

  // Register pending save with content for content-based verification.
  // Token prevents overlapping saves from clearing each other's entries.
  const saveToken = registerPendingSave(path, normalized.output);

  try {
    await invoke("atomic_write_file", { path, content: normalized.output });
  } catch (error) {
    return handleWriteError(tabId, path, saveToken, saveType, error);
  }

  applyPostSaveState(tabId, path, normalized, saveToken, saveType);
  await recordHistorySnapshot(path, normalized.output, saveType);

  return true;
}
