/**
 * Each document's saves still in flight, and the newest each document
 * published, so a close whose save was refused as superseded can tell
 * whether the save that refused it was the document's own — and wait for it.
 *
 * Key decisions:
 *   - A refusal counts for a close only when the save it names (Rust's
 *     `newest`) is the newest this document published: then the file holds
 *     this document's text. A save from another window or document may have
 *     left text this document never had, so it never counts, however clean
 *     the document reads.
 *   - A close waits only for the saves of its document asked for after its
 *     own (a larger order): only they can have saved the document. An older
 *     save that never answers — a write or path check with no deadline —
 *     cannot hold the close.
 *   - The wait is bounded (`CLOSE_WAIT_MS`). A newer save that has not
 *     answered by then leaves the document as it is, and the caller judges
 *     that: still unsaved, so the close reports not saved rather than hang.
 *
 * @coordinates-with saveToPath.ts — tracks every save; the close door waits here
 * @module services/persistence/saveInFlight
 */

import { isSameDocument, type SaveTargetClaim } from "./saveTargetClaim";

/** How long a close waits for the newer saves of its document. */
export const CLOSE_WAIT_MS = 10_000;

/** Each document's saves in flight, with the claim each was asked for with. */
const inFlight = new Map<string, Map<Promise<unknown>, SaveTargetClaim>>();

/** The newest save each document published, by tab. */
const published = new Map<string, SaveTargetClaim>();

/** Track `save`, asked for with `claim`, until it settles. */
export function trackInFlight<T>(claim: SaveTargetClaim, save: Promise<T>): Promise<T> {
  const { tabId } = claim;
  const saves = inFlight.get(tabId) ?? new Map<Promise<unknown>, SaveTargetClaim>();
  inFlight.set(tabId, saves);
  saves.set(save, claim);
  const done = () => {
    saves.delete(save);
    if (saves.size === 0 && inFlight.get(tabId) === saves) inFlight.delete(tabId);
  };
  save.then(done, done);
  return save;
}

/** The claim `save` of `tabId` was asked for with, while it is in flight. */
export function claimInFlight(tabId: string, save: Promise<unknown>): SaveTargetClaim | undefined {
  return inFlight.get(tabId)?.get(save);
}

/** Record that the save asked for with `claim` reached its file. */
export function recordPublished(claim: SaveTargetClaim): void {
  const last = published.get(claim.tabId);
  if (last && last.incarnation === claim.incarnation && last.seq >= claim.seq) return;
  published.set(claim.tabId, claim);
}

/**
 * Whether `newest`, the save a refusal names, is the newest save the
 * document `claim` names published, and that document is still open.
 */
export function isOwnNewest(claim: SaveTargetClaim, newest: number | null): boolean {
  const last = published.get(claim.tabId);
  return (
    newest !== null &&
    isSameDocument(claim) &&
    !!last &&
    last.incarnation === claim.incarnation &&
    last.seq === newest
  );
}

/**
 * Settle once every save of `tabId` asked for after `seq` has settled, or
 * once `CLOSE_WAIT_MS` pass, whichever is first.
 */
export async function waitForNewerSaves(tabId: string, seq: number): Promise<void> {
  const newer = [...(inFlight.get(tabId) ?? [])].filter(([, c]) => c.seq > seq).map(([save]) => save);
  if (newer.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLOSE_WAIT_MS);
  });
  try {
    await Promise.race([Promise.allSettled(newer), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
