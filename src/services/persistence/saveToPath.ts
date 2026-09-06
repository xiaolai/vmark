/**
 * Save Document to Path
 *
 * Purpose: Central save logic — normalizes content (line endings, hard breaks),
 * re-emits the document's BOM (decision D1), writes to disk, updates stores
 * with the dual save snapshots (WI-1.4), records history snapshots, and
 * manages pending save tracking for file watcher coordination.
 *
 * Key decisions:
 *   - Pending save is registered BEFORE write and cleared AFTER with 1000ms delay
 *     to handle late-arriving macOS FSEvents watcher events (full pipeline can
 *     exceed 500ms under heavy I/O: Rust debounce + emit + JS event loop + readFile)
 *   - Line ending and hard break normalization applied on save (not in-memory)
 *     to preserve the original editing experience while writing clean files
 *   - SERIALIZED PER PATH. Saves to one file run in submission order; saves to
 *     different files stay concurrent. Without this an older write could land
 *     second and be recorded as the saved snapshot — see serializeByPath.ts
 *   - History snapshots live in saveHistorySnapshot.ts. Failures don't block
 *     save success, but the call is AWAITED: `saveToPath` does not resolve
 *     until it settles, which close flows need. A hung history backend
 *     therefore holds the save promise open after the file and stores are
 *     already updated; a bounded timeout is the fix if that ever bites
 *   - Auto-save skips recent files list AND skips error toasts to avoid spam on
 *     a flaky disk; the user didn't initiate the action and the next manual save
 *     will surface the error
 *
 * @coordinates-with pendingSaves.ts — content-based save tracking for watcher coordination
 * @coordinates-with linebreaks.ts — line ending and hard break normalization
 * @coordinates-with documentStore.ts — markSaved/markAutoSaved state updates
 * @coordinates-with serializeByPath.ts — the per-path save queue
 * @coordinates-with saveTargetClaim.ts — per-DOCUMENT identity ordering, which
 *     the per-path queue cannot provide (audit 20260906, F3)
 * @coordinates-with saveHistorySnapshot.ts — version history snapshots
 * @coordinates-with services/coherence/captureFunnel.ts — fire-and-forget provenance capture
 *     (WI-1.6), gated on `general.coherenceCaptureOnSave` (default OFF): capture
 *     rewrites the file to insert a `vmark:` identity block, so it is opt-in
 * @module utils/saveToPath
 */
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
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
import { normalizePath } from "@/utils/paths";
import { serializeByPath } from "./serializeByPath";
import { claimSaveTarget, type SaveTargetClaim } from "./saveTargetClaim";
import { applyPostSaveState } from "./applyPostSaveState";
import type { NormalizedSaveContent } from "./normalizedSaveContent";
import { recordHistorySnapshot, type SaveType } from "./saveHistorySnapshot";
import { captureWrite } from "@/services/coherence/captureFunnel";
import { saveError } from "@/utils/debug";
import { commandErrorDetailString, isCommandErrorCode }
  from "@/services/commands/commandError";

/** Pre-WI-14 sentinel prefix. Transitional only — delete with its tests once
 *  the CommandError ratchet (`scripts/check-command-error-ratchet.mjs`) is 0. */
const PARENT_MISSING_PREFIX = "PARENT_MISSING:";

/**
 * The vanished directory, or `null` if this failure is something else.
 *
 * Typed first (`code: "not-found"` + `detail.dir`), legacy prefix second. The
 * prefix match is what the typed path replaced: it could not tell a real
 * sentinel from an OS message starting with those characters, and any
 * rewording of the Rust error silently disabled the Save As recovery.
 */
function parseParentMissingError(error: unknown): string | null {
  if (isCommandErrorCode(error, "not-found")) return commandErrorDetailString(error, "dir");
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : null;
  if (!message || !message.startsWith(PARENT_MISSING_PREFIX)) return null;
  return message.slice(PARENT_MISSING_PREFIX.length);
}

/** Normalized save payload plus the line-ending/hard-break styles applied. */

/**
 * Resolve the on-save line-ending and hard-break styles from the document's
 * detected state plus user settings, and apply them to produce the bytes that
 * will be written to disk.
 *
 * @public — exported for the Phase 1 all-ingress matrix (WI-1.9), which proves
 * round-trip fidelity against the REAL save pipeline rather than a re-implementation
 * that could drift from it.
 */
export function normalizeSaveContent(tabId: string, content: string): NormalizedSaveContent {
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
  const normalized = normalizeLineEndings(hardBreakNormalized, targetLineEnding);
  // Decision D1: the editor buffer is BOM-free and `hasBom` remembers that the
  // file began with U+FEFF. The save is the READER of that flag — without this
  // line it had writers and no readers, and a BOM'd file lost its mark on the
  // first save.
  const output = doc?.hasBom ? `\u{FEFF}${normalized}` : normalized;
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
    // Two-line toast (WI-UI4.4): paths/permission details as the detail.
    // Raw error — errorDetail owns the normalization (commandErrorMessage,
    // so a typed rejection cannot render "[object Object]").
    toast.errorDetail(i18n.t("dialog:toast.failedToSaveGeneric"), error);
  }
  return false;
}

/**
 * Serialized per path by `saveToPath`. Everything here — the write, the store
 * update, and the history snapshot — belongs to one save and must not
 * interleave with another save to the same file.
 */
async function performSave(
  tabId: string,
  path: string,
  content: string,
  saveType: SaveType,
  claim: SaveTargetClaim
): Promise<boolean> {
  // Normalized at RUN time, not submission time: a queued save must use the
  // document's convention as of its turn, not as of when it was requested.
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

  applyPostSaveState(tabId, path, content, normalized, saveToken, saveType, claim);
  await recordHistorySnapshot(path, normalized.output, saveType);

  // Coherence capture (WI-1.6, human funnel): fire-and-forget — a failed
  // capture never fails the save; scan reconciliation heals gaps. The
  // trailing catch guards the contract even if captureWrite ever throws.
  //
  // OPT-IN (`general.coherenceCaptureOnSave`, default off). Capture assigns a
  // Semantic Object identity, and doing so REWRITES the user's file to insert a
  // `vmark:` frontmatter block — prepending a whole block when the file has
  // none — and creates `.vmark/` in their workspace. Because autosave is on by
  // default, leaving this ungated stamped users' markdown silently, without
  // them ever pressing save. Editing someone's document is a decision they make.
  if (useSettingsStore.getState().general.coherenceCaptureOnSave) {
    void captureWrite({
      absolutePath: path,
      content: normalized.output,
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: saveType === "auto" ? "auto save" : "manual save" },
    }).catch(() => {});
  }

  return true;
}

/**
 * Write `content` to `path`, serialized against every other save to that path.
 *
 * Concurrent saves to one file used to race. A debounced auto-save and a
 * manual save can be in flight together, and nothing ordered their
 * `atomic_write_file` calls — so the OLDER content could land second and win
 * on disk, after which `applyPostSaveState` recorded it as the saved snapshot
 * and the document showed clean against bytes the user never wrote. The
 * pending-save token protected cleanup bookkeeping; it never ordered writes.
 */
export function saveToPath(
  tabId: string,
  path: string,
  content: string,
  saveType: SaveType = "manual"
): Promise<boolean> {
  // Claimed HERE — at submission, outside the per-path queue. Path
  // serialization orders writes to one file; it cannot order two saves of one
  // DOCUMENT to different files, which is exactly the autosave-then-Save-As
  // case (audit 20260906, F3). Claiming at submission also means the user's
  // most recent choice wins even if its write finishes first.
  const claim = claimSaveTarget(tabId);
  return serializeByPath(normalizePath(path), () =>
    performSave(tabId, path, content, saveType, claim)
  );
}
