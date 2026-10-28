/**
 * Per-document save-target claims.
 *
 * Purpose: decide whether a finished write is still allowed to change its
 * document's IDENTITY (file path, tab path, saved snapshots), or whether a
 * newer save has since superseded it.
 *
 * The defect this exists for: `saveToPath` serializes by
 * PATH, so a write to `/repo/old.md` and a Save As to `/repo/new.md` belong to
 * different queues and run concurrently. `applyPostSaveState` then changed the
 * document's path unconditionally on completion — so an autosave that started
 * before the Save As, and landed after it, reset both the document and the tab
 * to `/repo/old.md` and replaced the saved snapshots with the older file's.
 * Every later edit then targeted the file the user had just moved away from.
 *
 * Path serialization cannot fix this: the two saves are to different paths, and
 * they SHOULD stay concurrent. What has to be ordered is the identity change,
 * which belongs to the document, not to the file.
 *
 * A claim is taken at SUBMISSION time rather than at completion, so the winner
 * is the save the user asked for last, not the one whose disk write happened to
 * finish last. Two Save As operations resolve to the second destination
 * regardless of which write completes first.
 *
 * A request that can still be refused after admission (an MCP Save As: path
 * guard, approval, overwrite probe, the queued path guard, the no-replace
 * publication) RESERVES its place in that order, and the save pipeline
 * ACTIVATES it only once its write has succeeded. A reservation supersedes
 * nothing, so a refused or failed request can never suppress the post-save
 * state of an earlier save still in flight; an activated one ranks by its
 * admission, so a request admitted earlier but written later cannot override
 * a later one.
 *
 * Key decisions:
 *   - Sequence numbers and incarnations are module-wide and never reused, so
 *     closing a tab and reopening its id cannot recreate an equal claim.
 *   - A sequence number is a time: the later of one past the last issued and
 *     the wall clock's milliseconds counted in microseconds, so it increases
 *     even when the clock steps back, and saves from different documents and
 *     windows compare by when they were asked for. A refusal naming a newer
 *     time moves this clock past it (`observeSaveOrder`), so the next save is
 *     not refused.
 *   - A claim only names the document it was taken for while that document is
 *     open (`isSameDocument`): a queued save that outlives its document keeps
 *     the closed document's file conventions and never marks the new one saved.
 *   - The same order is sent with the write (`saveOrderOf`), so Rust can
 *     refuse a save older than one already published to that file, whichever
 *     document or window asked for it: the per-path queue cannot order two
 *     spellings of one file, nor a reopened document and its closed self.
 *
 * Known limitations:
 *   - Each window counts on its own clock, which reads whole milliseconds.
 *     Two windows' saves to one file asked for within the same millisecond
 *     (or with the clock stepping back between them) are ordered
 *     arbitrarily: either may be the one the file keeps.
 *
 * @coordinates-with saveToPath.ts — the pipeline that checks claims
 * @coordinates-with src-tauri/src/files/write/save_order.rs — enforces the order per file
 * @coordinates-with services/mcpBridge/v2/workspaceSaveAs.ts — reserves at admission; saveToPath.ts activates once written
 * @module services/persistence/saveTargetClaim
 */

/**
 * The newest claim issued for each open document, and the document INCARNATION
 * it belongs to. A tab moved out of the window and back keeps its id, so the id
 * alone cannot tell the reopened document from the closed one.
 */
const latestClaim = new Map<string, { readonly seq: number; readonly incarnation: number }>();

/**
 * Never reset while the module lives (only by the test seam), so a claim
 * issued before `forgetSaveTarget` can never equal one issued after it.
 */
let lastSeq = 0;
let lastIncarnation = 0;

/** A save's claim on its document's identity. Opaque to callers. */
export interface SaveTargetClaim {
  readonly tabId: string;
  readonly seq: number;
  readonly incarnation: number;
}

/**
 * A save's place in its document's order, taken at admission but not yet
 * effective. Not a claim: it must pass `activateSaveTarget` to become one.
 */
export interface SaveTargetReservation {
  readonly reserved: SaveTargetClaim;
}

/**
 * Reserve a place in `tabId`'s save order for a request that may still be
 * refused. Supersedes nothing until activated. It records the document's
 * incarnation, so a claim taken meanwhile names the same document.
 */
export function reserveSaveTarget(tabId: string): SaveTargetReservation {
  const entry = latestClaim.get(tabId);
  const incarnation = entry?.incarnation ?? ++lastIncarnation;
  // seq 0 is never issued, so a fresh entry makes no claim current.
  if (!entry) latestClaim.set(tabId, { seq: 0, incarnation });
  lastSeq = Math.max(lastSeq + 1, Math.floor(Date.now() * 1000));
  return { reserved: { tabId, seq: lastSeq, incarnation } };
}

/**
 * Turn a written save's reservation into its claim. It becomes the
 * newest claim only when nothing admitted after it has been activated or
 * claimed, and only while its document is still open; otherwise the claim is
 * returned already superseded (or naming a closed document).
 */
export function activateSaveTarget(reservation: SaveTargetReservation): SaveTargetClaim {
  const claim = reservation.reserved;
  const entry = latestClaim.get(claim.tabId);
  if (entry && entry.incarnation === claim.incarnation && entry.seq < claim.seq) {
    latestClaim.set(claim.tabId, { seq: claim.seq, incarnation: claim.incarnation });
  }
  return claim;
}

/**
 * Take a claim for a save that is about to be submitted for `tabId`.
 *
 * Call this at submission time — BEFORE the per-path queue — so ordering
 * reflects the order the user asked for the saves. A request that can still
 * be refused after admission reserves instead; the pipeline activates it once written.
 */
export function claimSaveTarget(tabId: string): SaveTargetClaim {
  return activateSaveTarget(reserveSaveTarget(tabId));
}

/**
 * Whether `claim` is still the newest one for its document.
 *
 * `false` means another save was submitted for this document after this one
 * started, or the document was closed since, so this completion must not
 * touch the document's path, tab path or saved snapshots. It already wrote its
 * bytes to disk successfully; only the identity bookkeeping is withheld.
 */
export function isCurrentSaveTarget(claim: SaveTargetClaim): boolean {
  return latestClaim.get(claim.tabId)?.seq === claim.seq;
}

/**
 * Whether the document `claim` was taken for is still open — superseded by a
 * newer save or not. `false` once it was closed, even when a document with the
 * same tab id has been opened since.
 */
export function isSameDocument(claim: SaveTargetClaim): boolean {
  return latestClaim.get(claim.tabId)?.incarnation === claim.incarnation;
}

/**
 * Drop a closed document's claim so the map does not grow across a long
 * session of opening and closing tabs. Its outstanding claims stop being
 * current and stop naming an open document.
 */
export function forgetSaveTarget(tabId: string): void {
  latestClaim.delete(tabId);
}

/** When the claim's save was asked for, as `atomic_write_file` takes it. */
export function saveOrderOf(claim: SaveTargetClaim): { seq: number } {
  return { seq: claim.seq };
}

/**
 * Move this clock past `newest`, the time of a save Rust already published,
 * so the next save is asked for after it. A value this clock could not have
 * issued (not a safe integer) is ignored.
 */
export function observeSaveOrder(newest: unknown): void {
  if (typeof newest === "number" && Number.isSafeInteger(newest) && newest > lastSeq) {
    lastSeq = newest;
  }
}

/** Test seam: drop every claim. */
export function resetSaveTargetClaims(): void {
  latestClaim.clear();
  lastSeq = 0;
  lastIncarnation = 0;
}
