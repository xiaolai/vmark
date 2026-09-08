/**
 * The export destination lock — one export per folder, ACROSS windows.
 *
 * Purpose: `runExclusive` in `exportStaging.ts` serializes exports inside one
 * webview, and that is all a JavaScript queue can do. VMark opens a document
 * per window, each with its own webview and its own module instances, so two
 * windows exporting to one folder had a queue each and published into it at
 * the same time (audit 20260907, #332). Whichever finished second overwrote
 * half of the first, and a failure in either rolled back over the other's
 * output.
 *
 * The lock is therefore a FILE the destination itself holds: every process
 * sees the same one, because the filesystem is the only thing they share.
 *
 * Key decisions:
 *   - `createNew: true` is the whole mechanism — an exclusive create is atomic
 *     in the OS, so "check then create" cannot interleave. Never replace it
 *     with `exists()` + `writeTextFile()`.
 *   - A lock is STALE after `EXPORT_LOCK_STALE_MS` and is taken over, because a
 *     window that crashed mid-export cannot release its own lock and a folder
 *     that can never be exported to again is worse than a rare double write.
 *     The threshold is far longer than the waiting limit, so a waiter never
 *     steals a lock it is queued behind.
 *   - **The takeover is a `rename`, not a write** (round 4). Reading the lock,
 *     judging it dead and overwriting it are three steps with nothing atomic
 *     between them, so two windows that both found one dead lock both "took"
 *     it — a takeover two processes can perform is not a lock. `rename` needs
 *     its SOURCE to exist, so exactly one mover wins and the rest see ENOENT.
 *   - **The lock names its OWNER** (round 4), a per-acquisition nonce, so a
 *     process can tell its own lock from a live foreign one. Without it a slow
 *     export whose lock was taken over would, on finishing, delete the lock of
 *     the window that took it — handing a third window the folder while the
 *     second was still publishing. A window LABEL is not used: uniqueness is
 *     the property that decides ownership, a nonce already has it, and reading
 *     the label would pull a Tauri window import into a module that otherwise
 *     needs nothing but the filesystem.
 *   - The lock is ADVISORY, and `holdsExportLock` is how a caller respects
 *     that: a stale takeover can happen to a holder that is merely SLOW, so an
 *     export re-checks ownership immediately before it publishes rather than
 *     trusting the token it took minutes earlier. That is what actually keeps
 *     two publishers out of one folder; the takeover rules only keep two
 *     TAKERS out. A heartbeat would close the remaining window, and is not
 *     used: a webview timer is throttled when its window is backgrounded, so
 *     the heartbeat would go quiet on a healthy export and invite exactly the
 *     seizure it was added to prevent.
 *   - A lock file that does not PARSE — or that parses without naming an
 *     OWNER — is not stale, ever, and is never overwritten: a file at that
 *     path this module did not write may be something else entirely, and
 *     taking it over would delete a stranger's data. For the same reason a
 *     lock this export cannot READ is never released — it is not provably
 *     ours — and a lock moved aside that could not be put back is KEPT under
 *     its aside name rather than discarded (round 5).
 *   - Only an "already exists" failure means contention. Anything else — a
 *     read-only volume, a permission denial — is reported at once rather than
 *     waited out, so the user sees the real error instead of a timeout.
 *
 * The takeover protocol itself lives in `exportLockTakeover.ts` and the lock
 * FILE — its shape, its exclusive write, and what an OS failure means — in
 * `exportLockFile.ts`; the reasoning stays here, where a reader arrives.
 *
 * @coordinates-with src/export/exportStaging.ts — the only consumer
 * @coordinates-with src/export/exportLockTakeover.ts — the stale takeover
 * @coordinates-with src/export/exportLockFile.ts — the file primitives
 * @module export/exportLock
 */

import { exportWarn } from "@/utils/debug";
import {
  exportLockPath,
  isAlreadyExists,
  nonce,
  parseLock,
  readQuietly,
  writeLock,
} from "./exportLockFile";
import { takeOverIfStale } from "./exportLockTakeover";
import { remove } from "@tauri-apps/plugin-fs";

export { EXPORT_LOCK_NAME, EXPORT_LOCK_STALE_MS, nonce } from "./exportLockFile";

/** How long a second export waits for the holder before giving up. */
export const EXPORT_LOCK_WAIT_MS = 30_000;

/** How often the waiter retries its exclusive create. */
const POLL_MS = 250;

/**
 * Take the lock on `destination`, waiting for a live holder, and return the
 * owner token that `releaseExportLock` needs.
 *
 * Rejects when the holder never releases it within `EXPORT_LOCK_WAIT_MS` —
 * naming the lock file, since deleting it is the user's escape hatch — and
 * rethrows any non-contention write failure immediately.
 */
export async function acquireExportLock(destination: string): Promise<string> {
  const lock = exportLockPath(destination);
  const owner = nonce();
  const startedAt = Date.now();

  for (;;) {
    try {
      await writeLock(lock, owner, { createNew: true });
      return owner;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }

    if (await takeOverIfStale(lock, owner)) return owner;

    if (Date.now() - startedAt >= EXPORT_LOCK_WAIT_MS) {
      throw new Error(
        `Another export is already writing to ${destination}. ` +
          `If no other export is running, delete ${lock} and try again.`,
      );
    }
    await delay(POLL_MS);
  }
}

/**
 * Release the lock held under `owner`.
 *
 * A lock carrying somebody else's owner is left alone: this export's own was
 * taken over as stale while it ran, and removing the successor's lock would
 * let a third export in beside it. A failure is logged either way — the
 * export's outcome does not depend on it.
 */
export async function releaseExportLock(destination: string, owner: string): Promise<void> {
  const lock = exportLockPath(destination);
  try {
    if (!(await holdsExportLock(destination, owner))) {
      exportWarn("Not releasing an export lock this export no longer holds:", lock);
      return;
    }
    await remove(lock);
  } catch (error) {
    exportWarn("Could not remove the export lock:", lock, error);
  }
}

/**
 * Whether the lock on `destination` is still the one `owner` created.
 *
 * The lock is ADVISORY — a holder that outlives the stale threshold can have
 * it taken over — so an export asks this before it publishes, rather than
 * assuming the lock it took at the start is still its own (#332).
 */
export async function holdsExportLock(destination: string, owner: string): Promise<boolean> {
  const text = await readQuietly(exportLockPath(destination));
  if (text === null) return false;
  return parseLock(text)?.owner === owner;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
