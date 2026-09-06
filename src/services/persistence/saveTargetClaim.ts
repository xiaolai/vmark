/**
 * Per-document save-target claims.
 *
 * Purpose: decide whether a finished write is still allowed to change its
 * document's IDENTITY (file path, tab path, saved snapshots), or whether a
 * newer save has since superseded it.
 *
 * The defect this exists for (audit 20260906, F3): `saveToPath` serializes by
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
 * @coordinates-with saveToPath.ts — the only caller
 * @module services/persistence/saveTargetClaim
 */

/** The newest claim sequence issued for each document. */
const latestClaim = new Map<string, number>();

/** A save's claim on its document's identity. Opaque to callers. */
export interface SaveTargetClaim {
  readonly tabId: string;
  readonly seq: number;
}

/**
 * Take a claim for a save that is about to be submitted for `tabId`.
 *
 * Call this at submission time — BEFORE the per-path queue — so ordering
 * reflects the order the user asked for the saves.
 */
export function claimSaveTarget(tabId: string): SaveTargetClaim {
  const seq = (latestClaim.get(tabId) ?? 0) + 1;
  latestClaim.set(tabId, seq);
  return { tabId, seq };
}

/**
 * Whether `claim` is still the newest one for its document.
 *
 * `false` means another save was submitted for this document after this one
 * started, so this completion must not touch the document's path, tab path or
 * saved snapshots. It already wrote its bytes to disk successfully; only the
 * identity bookkeeping is withheld.
 */
export function isCurrentSaveTarget(claim: SaveTargetClaim): boolean {
  return latestClaim.get(claim.tabId) === claim.seq;
}

/**
 * Drop a closed document's claim so the map does not grow across a long
 * session of opening and closing tabs.
 */
export function forgetSaveTarget(tabId: string): void {
  latestClaim.delete(tabId);
}

/** Test seam: drop every claim. */
export function resetSaveTargetClaims(): void {
  latestClaim.clear();
}
