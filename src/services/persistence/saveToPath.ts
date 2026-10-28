/**
 * Save Document to Path
 *
 * Purpose: Central save logic — normalizes content (line endings, hard breaks),
 * re-emits the document's BOM (decision D1), writes to disk, updates stores
 * with the dual save snapshots, records history snapshots, and
 * manages pending save tracking for file watcher coordination.
 *
 * Key decisions:
 *   - Pending save is registered BEFORE write and cleared AFTER with 1000ms delay
 *     to handle late-arriving macOS FSEvents watcher events (full pipeline can
 *     exceed 500ms under heavy I/O: Rust debounce + emit + JS event loop + readFile)
 *   - Line ending and hard break normalization applied on save (not in-memory)
 *     to preserve the original editing experience while writing clean files
 *   - SERIALIZED PER PATH. Saves to one file run in submission order; saves to
 *     different files stay concurrent. "One file" is its identity
 *     (`fileIdentity.ts`), so two spellings of it share one queue. Without this an older write could land
 *     second and be recorded as the saved snapshot — see serializeByPath.ts.
 *     A symlink is not a spelling: Rust's per-file lock
 *     (`files/write/target_lock.rs`) keeps writes through it and its target
 *     from interleaving, and refuses a save older than one already published
 *     there (`files/write/save_order.rs`), whichever document asked for it;
 *     the close door (`saveToPathForClose`) reports that refusal as saved
 *     when the save that refused it is the document's own and left nothing
 *     to save — after waiting, a bounded time, for the document's newer
 *     saves — so a close is not cancelled. One document's saves
 *     to two paths are deliberately not queued together, so a stalled write
 *     to the old path never blocks a Save As.
 *   - History snapshots live in saveHistorySnapshot.ts. Failures don't block
 *     save success, but the call is AWAITED: `saveToPath` does not resolve
 *     until it settles, which close flows need. It settles within
 *     `SNAPSHOT_TIMEOUT_MS`, so a hung history backend delays a save and the
 *     saves queued behind it on its path by that much, never forever
 *   - Auto-save skips recent files list AND skips error toasts to avoid spam on
 *     a flaky disk; the user didn't initiate the action and the next manual save
 *     will surface the error
 *   - ONE pipeline for every writer of a document. An AI client's write over
 *     the MCP bridge enters through `saveToPathForMcp` and gets the same
 *     normalization, ordering, atomic write, history snapshot and saved
 *     snapshots as a human save. What differs is decided here, per origin, and
 *     nowhere else: it never toasts (its caller reports the reason to the
 *     client — a toast on top would report one failure twice), it does not
 *     join the recent files, it never switches the visible workspace, and its
 *     provenance is captured as an MCP write naming the tool, with the reads
 *     its client made before the save was submitted as its inputs
 *   - A failed save says WHY (`SaveOutcome`). `saveToPath` keeps its boolean
 *     for the human callers, which act on document state rather than a reason
 *   - An MCP request may RESERVE its place in the document's save order when
 *     it is ADMITTED and run its path guard at the save's turn in the
 *     per-path queue, so no await before the queue can reorder it behind a
 *     later save. The reservation is activated only once its bytes reach the
 *     disk: a request refused by its path guard or its no-replace
 *     publication, or whose write fails, never supersedes an earlier save
 *   - The ownership check excludes the saving tab only while it still holds
 *     the document the save was claimed for: a save that outlived its tab's
 *     close is checked against the tab reopened under its id like any other
 *   - The ownership check runs at the save's turn, synchronously before the
 *     write, and is not held across the write's await. It refuses a write
 *     over a copy with unsaved changes at that turn; a copy that gains them
 *     while the write is in flight ends exactly as one that gains them just
 *     after it lands, which the rule allows. Holding it across the write
 *     would mean blocking edits in every other tab for a disk round trip
 *   - A save counts as written the moment its bytes reach the disk: an MCP
 *     save whose later bookkeeping throws still consumed its client's reads
 *
 * @coordinates-with pendingSaves.ts — content-based save tracking for watcher coordination
 * @coordinates-with saveNormalize.ts — line ending, hard break and BOM normalization
 * @coordinates-with documentStore.ts — markSaved/markAutoSaved state updates
 * @coordinates-with serializeByPath.ts — the per-path save queue
 * @coordinates-with saveInFlight.ts — each document's saves in flight, for the close door
 * @coordinates-with saveTargetClaim.ts — per-DOCUMENT identity ordering, which
 *     the per-path queue cannot provide
 * @coordinates-with saveHistorySnapshot.ts — version history snapshots
 * @coordinates-with services/agentJournal/saveJournal.ts — records the save in
 *     the agent edit journal (awaited, never fails the save) before the
 *     snapshot, so an "mcp" snapshot can name the journal revision
 * @coordinates-with saveOutcome.ts — who asked for a save and how it ended
 * @coordinates-with saveWriteError.ts — a rejected write's failure and feedback
 * @coordinates-with saveCapture.ts — fire-and-forget provenance capture, one per
 *     write, human or MCP. `general.coherenceCaptureOnSave` (default OFF) is
 *     enforced by the capture funnel and the kernel for EVERY write path, not here
 * @coordinates-with services/mcpBridge/v2/bridgeSave.ts — the MCP entry's only caller
 * @module services/persistence/saveToPath
 */
import { invoke } from "@tauri-apps/api/core";
import {
  resolveWritableFileOwnership,
  showFileOwnershipConflictToast,
} from "@/services/workspaces/fileOwnership";
import { registerPendingSave } from "@/utils/pendingSaves";
import { handleWriteError, isDocumentAtRest } from "./saveWriteError";
import { fileIdentityKey } from "@/utils/paths/fileIdentity";
import { getRuntimePlatform } from "@/utils/platform";
import { serializeByPath } from "./serializeByPath";
import { claimInFlight, isOwnNewest, recordPublished, trackInFlight, waitForNewerSaves } from "./saveInFlight";
import {
  activateSaveTarget,
  claimSaveTarget,
  saveOrderOf,
  isSameDocument,
  type SaveTargetClaim,
  type SaveTargetReservation,
} from "./saveTargetClaim";
import { applyPostSaveState } from "./applyPostSaveState";
import { documentSaveFormat, normalizeWithFormat, type SaveFormat } from "./saveNormalize";
import { recordHistorySnapshot } from "./saveHistorySnapshot";
import type { McpSaveAdmission, SaveOutcome } from "./saveOutcome";
import type { McpAttribution } from "@/services/mcpBridge/types";
import { captureSave, type CaptureOrigin } from "./saveCapture";
import { detachMcpReads, restoreMcpReads } from "@/services/coherence/mcpCapture";
import { beginJournalSave, type JournalSaveTicket } from "@/services/agentJournal/saveJournal";

export { normalizeSaveContent } from "./saveNormalize";

/** What a save carries from its submission into its queued turn. */
interface SaveTicket {
  /** The save's claim; while `reservation` is set, only its reserved place. */
  claim: SaveTargetClaim;
  /** Activated when the write succeeds, so a refused or failed save supersedes nothing. */
  reservation: SaveTargetReservation | undefined;
  /** The document's conventions when the save was submitted. */
  format: SaveFormat | undefined;
  journal: JournalSaveTicket;
  /** Set the moment the bytes reach the disk, before any bookkeeping. */
  wrote: boolean;
  /** Refuse, rather than replace, a file already at the path when it publishes. */
  noReplace: boolean;
}

/**
 * Serialized per path by `submitSave`. Everything here — the write, the store
 * update, and the history snapshot — belongs to one save and must not
 * interleave with another save to the same file.
 */
async function performSave(
  tabId: string,
  path: string,
  content: string,
  origin: CaptureOrigin,
  ticket: SaveTicket
): Promise<SaveOutcome> {
  const { saveType } = origin;
  const { claim, journal } = ticket;
  // Normalized at RUN time, not submission time: a queued save must use the
  // document's convention as of its turn, not as of when it was requested.
  // @edge-case: the document closed since submission (its tab id may name a
  // new document now) — the conventions captured at submission still apply.
  const format = isSameDocument(claim) ? documentSaveFormat(tabId) : ticket.format;
  const normalized = normalizeWithFormat(format, content);

  // Checked synchronously before the write, with no await between. A save of
  // a document closed since (its tab id may hold a newer one) excludes no tab.
  const ownership = resolveWritableFileOwnership(tabId, path, { foreignTab: !isSameDocument(claim) });
  if (!ownership.ok) {
    if (saveType === "manual") showFileOwnershipConflictToast(path, ownership.conflicts);
    return { ok: false, reason: "ownership-conflict", conflicts: ownership.conflicts };
  }

  // Register pending save with content for content-based verification.
  // Token prevents overlapping saves from clearing each other's entries.
  const saveToken = registerPendingSave(path, normalized.output);

  try {
    // `noReplace` only when asked, so an ordinary save's call is unchanged.
    const exclusive = ticket.noReplace ? { noReplace: true } : {};
    const order = saveOrderOf(claim);
    await invoke("atomic_write_file", { path, content: normalized.output, order, ...exclusive });
  } catch (error) {
    return handleWriteError(claim, path, saveToken, saveType, error);
  }
  ticket.wrote = true;
  recordPublished(claim);

  if (ticket.reservation) activateSaveTarget(ticket.reservation);
  applyPostSaveState(tabId, path, content, normalized, saveToken, saveType, claim);
  const journaled = await journal.record();
  await recordHistorySnapshot(path, normalized.output, saveType, journaled.revision);
  captureSave(path, normalized.output, origin);

  return { ok: true, written: normalized.output, journaled: journaled.journaled };
}

/**
 * Submit one save: claim the document (or carry the place its request
 * reserved at admission), then queue the write behind every
 * earlier save to the same path. The single entry both public doors use, so
 * no writer can reach the disk without the claim and the queue.
 */
function submitSave(
  tabId: string,
  path: string,
  content: string,
  origin: CaptureOrigin,
  admission: McpSaveAdmission = {}
): Promise<SaveOutcome> {
  // Claimed HERE — at submission, outside the per-path queue — unless the
  // caller reserved its place earlier, at admission. Path serialization orders writes to
  // one file; it cannot order two saves of one DOCUMENT to different files,
  // which is exactly the autosave-then-Save-As case. Claiming at submission
  // also means the user's most recent choice wins even if its write finishes first.
  const ticket: SaveTicket = {
    claim: admission.reservation?.reserved ?? claimSaveTarget(tabId),
    reservation: admission.reservation,
    format: documentSaveFormat(tabId),
    // The journal base is frozen here too: the text was built on it, and an
    // agent commit during the write must not become its parent. A save that
    // records nothing passes the base on, or the next save would wait forever.
    // Cancelled inside the queued task, not on the returned promise: an extra
    // hop there would let the next queued save run before this caller resumes.
    journal: beginJournalSave(tabId, path, content, origin),
    wrote: false,
    noReplace: admission.noReplace === true,
  };
  // Keyed by file identity: two spellings of one file share one queue.
  return trackInFlight(ticket.claim, serializeByPath(fileIdentityKey(path, getRuntimePlatform()), async () => {
    try {
      // The admission check runs at the save's turn, so its await cannot let
      // a later save of this file reach the disk first.
      const refusal = admission.admit ? await admission.admit() : null;
      if (refusal) return { ok: false, ...refusal };
      return await performSave(tabId, path, content, origin, ticket);
    } finally {
      ticket.journal.cancel();
      // A save that wrote nothing consumed no reads: they precede the client's
      // next write. A batch admitted with the request is its owner's to give back.
      if (!ticket.wrote && origin.saveType === "mcp" && !admission.reads) restoreMcpReads(origin.reads);
    }
  }));
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
  saveType: "manual" | "auto" = "manual"
): Promise<boolean> {
  return submitSave(tabId, path, content, { saveType }).then((outcome) => outcome.ok);
}

/**
 * The same save, for a close or quit, which needs the document saved: true
 * when this content was written for the document the tab still holds, or was
 * refused as superseded by the document's own newest save while the document
 * has nothing more to save. An edit that lands during the write stays dirty;
 * the close and quit loops revalidate and save it again. Save As and Move
 * keep `saveToPath`, whose path must be written.
 */
export async function saveToPathForClose(tabId: string, path: string, content: string): Promise<boolean> {
  const save = submitSave(tabId, path, content, { saveType: "manual" });
  const claim = claimInFlight(tabId, save);
  const outcome = await save;
  if (!claim) return false;
  // Written; but if the tab now holds another document, that one is unsaved.
  if (outcome.ok) return isSameDocument(claim);
  if (outcome.reason !== "superseded") return false;
  // Saved only when the file holds this document's own newer save, and the
  // document has nothing more to save.
  const savedByNewer = () => isOwnNewest(claim, outcome.newest) && isDocumentAtRest(tabId);
  if (savedByNewer()) return true;
  // That save is on disk, but its answer can reach this webview after the
  // refusal did: let it finish recording itself (bounded), then look again.
  await waitForNewerSaves(tabId, claim.seq);
  return savedByNewer();
}

/**
 * The same save, for an AI client writing through the MCP bridge.
 *
 * `content` is editor-domain text (LF, BOM-free), exactly as for `saveToPath`.
 * The outcome says why a save wrote nothing, because the bridge has to tell
 * the client — and it is the bridge's only feedback channel: this door never
 * toasts. `toolName` (`document.write`, `workspace.save`, …) and `actor`, the
 * client whose request this is, are recorded as the write's provenance.
 * `admission` carries the place reserved when the request was admitted, the
 * check (the path guard) to run at the save's turn, and `noReplace` for a
 * Save As that must not replace a file already at `path`.
 */
export function saveToPathForMcp(
  tabId: string,
  path: string,
  content: string,
  toolName: string,
  actor: McpAttribution,
  admission?: McpSaveAdmission
): Promise<SaveOutcome> {
  // Detached before any await, unless the request detached its batch at
  // admission: a read made while this save is queued or writing is the next write's.
  const reads = admission?.reads ?? detachMcpReads(actor.connectionId);
  return submitSave(tabId, path, content, { saveType: "mcp", toolName, actor, reads }, admission);
}
