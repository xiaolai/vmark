/**
 * Save write errors — turns a rejected `atomic_write_file` into the failure a
 * save reports, the document state it implies, and (for a manual save) a toast.
 *
 * Purpose: split out of `saveToPath.ts` (size gate). The write command's typed
 * errors are read here and nowhere else in the pipeline:
 *   - `not-found` + `detail.dir`: the file's folder vanished. The document is
 *     marked missing so Save handlers route through Save As — but only when
 *     the save's claim still names the open document and the failed path is
 *     that document's current path. A Save As to a vanished destination, or a
 *     queued save that outlived its document, says nothing about the live
 *     document's own file.
 *   - `conflict` + `detail.kind = "target-exists"`: a no-replace write found a
 *     file already at the path when it published; that file was kept.
 *   - `conflict` + `detail.kind = "superseded"`: a save asked for after this
 *     one already reached that file, so this older one wrote nothing. Never
 *     toasted: the newer save is the user's latest, and it succeeded. The
 *     refusal's `detail.newest` moves the save clock past that save, and the
 *     failure carries it, so a close can tell whether that save was its
 *     document's own (`saveInFlight.ts`).
 *   - anything else is a plain write failure, carried raw.
 *
 * @coordinates-with saveToPath.ts — the only caller
 * @coordinates-with saveTargetClaim.ts — `isSameDocument`, which ties a failure to its document
 * @coordinates-with src-tauri/src/files/write/failures.rs — the typed errors read here
 * @coordinates-with src-tauri/src/files/write/save_order.rs — the superseded refusal
 * @module services/persistence/saveWriteError
 */
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { isSameFile } from "@/utils/paths/fileIdentity";
import { getRuntimePlatform } from "@/utils/platform";
import { clearPendingSave, type registerPendingSave } from "@/utils/pendingSaves";
import { saveError } from "@/utils/debug";
import {
  commandErrorDetailString,
  isCommandErrorCode,
  parseCommandError,
} from "@/services/commands/commandError";
import { isSameDocument, observeSaveOrder, type SaveTargetClaim } from "./saveTargetClaim";
import type { SaveType } from "./saveHistorySnapshot";
import type { SaveOutcome } from "./saveOutcome";

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

/** The `detail.kind` of a `conflict` refusal, or `null` for anything else. */
function conflictKind(error: unknown): string | null {
  return isCommandErrorCode(error, "conflict") ? commandErrorDetailString(error, "kind") : null;
}

/** Whether `path` is still the file of the open document `claim` names. */
function isOwnFile(claim: SaveTargetClaim, path: string): boolean {
  if (!isSameDocument(claim)) return false;
  const live = useDocumentStore.getState().getDocument(claim.tabId)?.filePath;
  return !!live && isSameFile(live, path, getRuntimePlatform());
}

/** Whether the document is open with nothing to save: not dirty, not divergent from its file. */
export function isDocumentAtRest(tabId: string): boolean {
  const doc = useDocumentStore.getState().getDocument(tabId);
  return !!doc && !doc.isDirty && !doc.isDivergent;
}

/** Mark the claim's document missing when `path` is still that document's own file. */
function markMissingIfOwnFile(claim: SaveTargetClaim, path: string): void {
  if (isOwnFile(claim, path)) useDocumentStore.getState().markMissing(claim.tabId);
}

/**
 * Map a failed write to user feedback, document state and the failure the
 * caller propagates, clearing the pending save first. Only a manual save
 * toasts.
 */
export function handleWriteError(
  claim: SaveTargetClaim,
  path: string,
  saveToken: ReturnType<typeof registerPendingSave>,
  saveType: SaveType,
  error: unknown
): SaveOutcome {
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
    markMissingIfOwnFile(claim, path);
    if (saveType === "manual") {
      toast.error(
        i18n.t("dialog:toast.failedToSaveParentMissing", { dir: missingDir }),
        { pin: true },
      );
    }
    return { ok: false, reason: "parent-missing", dir: missingDir };
  }

  // Only an MCP Save As asks for no-replace, and that door never toasts:
  // its caller reports the refusal to the client.
  const kind = conflictKind(error);
  if (kind === "target-exists") return { ok: false, reason: "target-exists", path };
  if (kind === "superseded") {
    const detail = parseCommandError(error)?.detail;
    const newest: unknown = detail?.newest;
    observeSaveOrder(newest);
    // Only a save recorded for this file names who the file holds; the floor's names a forgotten file's.
    const named = detail?.recorded === true && Number.isSafeInteger(newest) ? (newest as number) : null;
    return { ok: false, reason: "superseded", path, newest: named };
  }

  // Manual saves toast; auto-saves stay quiet so a flaky disk doesn't pop
  // a notification every interval. The next manual save (or an external
  // signal like the file becoming missing) will surface the problem.
  if (saveType === "manual") {
    // Two-line toast: paths/permission details as the detail.
    // Raw error — errorDetail owns the normalization (commandErrorMessage,
    // so a typed rejection cannot render "[object Object]").
    toast.errorDetail(i18n.t("dialog:toast.failedToSaveGeneric"), error);
  }
  return { ok: false, reason: "write-failed", error };
}
