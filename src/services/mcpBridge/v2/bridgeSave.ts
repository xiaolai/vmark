/**
 * Purpose: the ONE way an MCP bridge handler puts a document on disk.
 *
 * `document.write`, `workspace.save` and `workspace.save_as` used to call
 * plugin-fs `writeTextFile` themselves. Writing around the app's save pipeline
 * meant an AI client's write lost the file's line endings and byte-order mark,
 * was not ordered against other saves of the same file (last write wins), could
 * be re-pointed to the old path by a late autosave after a Save As, took no
 * history snapshot, and was not atomic. This module hands the write to
 * `saveToPathForMcp` — the same pipeline a human save runs — and renders a
 * failure as a reason the handler can report to the client.
 *
 * Key decisions:
 *   - The path guard runs on every call, as the pipeline's admission check. A
 *     handler cannot reach the disk without it, whatever it checked earlier;
 *     `save_as` checks first as well because its overwrite probe needs the
 *     verdict before it may touch the path at all.
 *   - The save is SUBMITTED before the guard's round trip: the guard runs at
 *     the save's turn in the per-path queue. Submitted after it, a request
 *     delayed in that await could land its older bytes after a later save of
 *     the file, or take a newer claim than a later Save As and re-point the
 *     tab. A handler that awaits before saving (`save_as`) reserves its place
 *     in the document's save order at admission and passes the reservation
 *     in; the pipeline activates it only once the write succeeds.
 *   - The caller passes the content. Each handler captures the buffer at the
 *     moment its write is defined, before any await; reading the store here,
 *     after the guard's round trip, would save whatever a later request put
 *     there under this request's name.
 *   - Failure messages are plain English for an AI client, not localized UI
 *     copy: the pipeline shows the human nothing for an MCP save, so this
 *     text is the whole report.
 *   - A rejected write keeps its raw rejection (`cause`). The handlers that
 *     answer a failed save with an error reply rethrow it, so `wrapHandler`
 *     renders a typed error with its token exactly as for any other command.
 *   - A success carries the save's `journaled` flag. A save the journal did
 *     not record is still a success: the file is on disk.
 *
 * @coordinates-with services/persistence/saveToPath.ts — saveToPathForMcp, the pipeline
 * @coordinates-with services/persistence/saveOutcome.ts — the failure being rendered
 * @coordinates-with services/mcpBridge/bridgePathGuard.ts — checkBridgePath
 * @coordinates-with __tests__/bridgeWriteInvariant.test.ts — holds this as the only door
 * @module services/mcpBridge/v2/bridgeSave
 */
import { checkBridgePath } from "@/services/mcpBridge/bridgePathGuard";
import { respond } from "@/services/mcpBridge/utils";
import { saveToPathForMcp } from "@/services/persistence/saveToPath";
import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import type { SaveFailure } from "@/services/persistence/saveOutcome";
import type { SaveTargetReservation } from "@/services/persistence/saveTargetClaim";
import type { McpReadBatch } from "@/services/coherence/mcpCapture";
import type { Journaled } from "@/services/agentJournal/journalClient";
import { commandErrorMessage } from "@/services/commands/commandError";
import { getFileName } from "@/utils/paths";
import { v2ErrorString, type V2ErrorCode } from "./types";

/** A bridge save that wrote nothing, and why. */
export interface BridgeSaveFailure {
  saved: false;
  reason: SaveFailure["reason"];
  /** What to tell the AI client. */
  message: string;
  /** The raw rejection, for `write-failed` only. */
  cause?: unknown;
}

/**
 * A bridge save that wrote the file. `journaled` says whether the agent edit
 * journal recorded the saved text: "yes", "pending" (recorded, ordered after
 * a write still in flight) or "no" (the file is saved; the journal is not).
 */
interface BridgeSaveSuccess {
  saved: true;
  journaled: Journaled;
}

export type BridgeSaveResult = BridgeSaveSuccess | BridgeSaveFailure;

/**
 * The refusal `save_as` gives for a destination that already holds a file,
 * whether its overwrite probe saw the file or the no-replace write met it.
 */
export function overwriteRefusal(name: string): string {
  return (
    `Refusing to overwrite the existing file ${name}. ` +
    `save_as will not replace a file that is not the tab's own path. ` +
    `Choose a different filePath, or have the user open ${name} and save over it deliberately.`
  );
}

/** Render a pipeline failure for an AI client. */
function describeFailure(failure: SaveFailure): string {
  switch (failure.reason) {
    case "ownership-conflict": {
      // Named by tab id and window label: the identifiers `session.get_state`
      // gives the client, so it can act on the tab that holds the file.
      const holders = failure.conflicts
        .map((claim) => `tab ${claim.tabId} in window ${claim.windowLabel}`)
        .join(", ");
      return (
        `Another open tab has unsaved changes to this file (${holders}); ` +
        "it must be saved or closed before this tab can write the file"
      );
    }
    case "parent-missing":
      return (
        `The folder ${failure.dir} no longer exists; ` +
        "use workspace.save_as to choose a new location"
      );
    case "write-failed":
      return commandErrorMessage(failure.error);
    case "path-denied":
      return failure.detail;
    case "target-exists":
      return overwriteRefusal(getFileName(failure.path) || failure.path);
    case "superseded":
      return (
        `A save made after this one already reached ${failure.path}, so this older one wrote nothing. ` +
        "Read the document before writing again"
      );
  }
}

/**
 * Save `content` as tab `tabId`'s document at `path`, through the path guard
 * and the app's save pipeline, on behalf of MCP tool `toolName` called by the
 * client `context` names — the client the provenance capture records.
 *
 * `content` is editor-domain text (LF, no byte-order mark); the pipeline
 * re-applies the file's own convention on the way out. `admission.reservation`
 * is the place the handler reserved at admission, when it awaited anything
 * before calling; `admission.noReplace` makes the write refuse (`target-exists`)
 * rather than replace a file already at `path` when it publishes;
 * `admission.reads` the read batch the request detached at admission.
 */
export async function saveTabForBridge(
  tabId: string,
  path: string,
  content: string,
  toolName: string,
  context: McpWriteContext,
  admission: { reservation?: SaveTargetReservation; noReplace?: boolean; reads?: McpReadBatch } = {},
): Promise<BridgeSaveResult> {
  const admit = async (): Promise<SaveFailure | null> => {
    const decision = await checkBridgePath(path);
    return decision.allowed ? null : { reason: "path-denied", detail: decision.reason };
  };
  // No await before this call: the save takes its place in the queue now.
  const outcome = await saveToPathForMcp(tabId, path, content, toolName, context.attribution, { ...admission, admit });
  if (outcome.ok) return { saved: true, journaled: outcome.journaled };
  return {
    saved: false,
    reason: outcome.reason,
    message: describeFailure(outcome),
    ...(outcome.reason === "write-failed" ? { cause: outcome.error } : {}),
  };
}

/**
 * The error code each refusal is reported under. A refused or vanished
 * location is a path problem the client can act on; an ownership conflict is
 * not about the path at all. Keyed by reason so a new one cannot be added
 * without deciding its code.
 */
const REFUSAL_CODE: Record<Exclude<BridgeSaveFailure["reason"], "write-failed">, Exclude<V2ErrorCode, "ABORTED">> = {
  "path-denied": "INVALID_PATH",
  "parent-missing": "INVALID_PATH",
  "ownership-conflict": "INTERNAL",
  // Overwriting a file that is not the tab's own needs the user, as when
  // save_as's own probe finds it.
  "target-exists": "APPROVAL_REQUIRED",
  // The file already holds a save made after this one: read, then retry.
  superseded: "STALE",
};

/**
 * Answer a request whose whole purpose was the save (`workspace.save`,
 * `workspace.save_as`) with the failure. `document.write` does not use this:
 * its buffer update succeeded, so it reports the save as a field of a
 * successful reply.
 *
 * A rejected write is RETHROWN rather than rendered here, so `wrapHandler`
 * stays the one place a thrown rejection becomes a reply — a typed error
 * keeps its token and its structured half.
 */
export async function respondSaveFailed(id: string, failure: BridgeSaveFailure): Promise<void> {
  if (failure.reason === "write-failed") throw failure.cause;
  await respond({
    id,
    success: false,
    error: v2ErrorString({ error: REFUSAL_CODE[failure.reason], message: failure.message }),
  });
}
