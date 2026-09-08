/**
 * Wresting an export lock from a holder that is gone.
 *
 * Purpose: the one genuinely concurrent thing this feature does, on its own so
 * it can be read as one argument (round 5, #662). Its rules — and the reasons
 * each of them exists — are in `exportLock.ts`'s header, which is where a
 * reader arrives from.
 *
 * The shape, in order, because every step is load-bearing:
 *   1. READ and judge. Unparseable, ownerless or young → not ours to take.
 *   2. MOVE ASIDE, which is the atomic step: `rename` needs its source to
 *      exist, so exactly one of the windows that judged this lock dead wins and
 *      the rest see ENOENT. A read-then-write "takeover" is one two processes
 *      can both perform, which is not a takeover.
 *   3. RE-READ what was moved. The holder could have released it and a NEW one
 *      taken it between (1) and (2), in which case a LIVE lock was just moved.
 *   4. CREATE exclusively. Losing here means a third window got there first.
 *   5. On any failure after (2), PUT THE PRIOR LOCK BACK. Staleness is a clock
 *      heuristic, so the holder judged dead may only be slow, and deleting its
 *      lock leaves the destination with none at all.
 *
 * @coordinates-with src/export/exportLock.ts — the caller, and the reasoning
 * @module export/exportLockTakeover
 */

import { rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { exportWarn } from "@/utils/debug";
import {
  EXPORT_LOCK_STALE_MS,
  isAlreadyExists,
  nonce,
  parseLock,
  readQuietly,
  removeQuietly,
  stillThere,
  writeLock,
} from "./exportLockFile";

/**
 * Take over a lock whose holder is long gone, if this call is the one that
 * wins the move. False for anything unparseable, anything still young, and
 * for every loser of the race.
 */
export async function takeOverIfStale(lock: string, owner: string): Promise<boolean> {
  const dead = await staleContents(lock);
  if (dead === null) return false;

  // Atomic: `rename` needs its source to exist, so of every window that judged
  // this lock stale exactly one moves it and the rest see ENOENT (#332).
  const aside = `${lock}.stale-${nonce()}`;
  try {
    await rename(lock, aside);
  } catch (error) {
    // Only a LOST RACE may be swallowed: another window moved this same lock
    // first, so the source is gone. Anything else — a denial, a read-only
    // volume — is this destination's real failure, and swallowing it spent the
    // whole wait before blaming contention that never happened (audit R2,
    // #663), against the header's own rule. Asked of the filesystem, never
    // matched on a message the OS words differently per platform.
    if (await stillThere(lock)) throw error;
    return false;
  }

  // The holder could have released it and a NEW one taken it between the read
  // above and the move, in which case what was just moved is a LIVE lock. Put
  // it back and stand down rather than publish beside its owner.
  const moved = await readQuietly(aside);
  if (moved !== dead) {
    await putBack(lock, aside, moved);
    return false;
  }

  try {
    await writeLock(lock, owner, { createNew: true });
  } catch (error) {
    // The prior lock goes BACK, it is not deleted (round 5). This call did not
    // become the holder, so the folder must be left as it was found: staleness
    // is a clock heuristic, and deleting the lock of a holder that was merely
    // slow left the destination with no lock at all.
    await putBack(lock, aside, dead);
    if (isAlreadyExists(error)) return false;
    throw error;
  }
  await removeQuietly(aside);
  return true;
}

/** The lock's raw text if it parses AND is older than the stale threshold. */
async function staleContents(lock: string): Promise<string | null> {
  const text = await readQuietly(lock);
  if (text === null) return null;
  const parsed = parseLock(text);
  if (typeof parsed?.acquiredAt !== "number") return null;
  // A lock this module wrote always NAMES its owner, so JSON without one is
  // not one of ours — and taking it over would delete a stranger's file, the
  // same reason unparseable text is never stale (round 5).
  if (typeof parsed.owner !== "string" || parsed.owner === "") return null;
  return Date.now() - parsed.acquiredAt >= EXPORT_LOCK_STALE_MS ? text : null;
}

/** Return a live lock this call moved aside by mistake, exclusively. */
async function putBack(lock: string, aside: string, text: string | null): Promise<void> {
  if (text !== null) {
    try {
      // Exclusive: if a third window has already created one, that window is
      // the holder and this text is stale. Refusing here is the safe outcome —
      // this call returns false either way and never becomes a publisher.
      await writeTextFile(lock, text, { createNew: true });
    } catch (error) {
      if (!isAlreadyExists(error)) {
        // Not restorable, and not superseded either: the file this call moved
        // is the only copy of that lock, so it is KEPT and its path named —
        // the rule `exportPublish` applies to a backup it could not put back.
        // Discarding it here would silently unlock the destination.
        exportWarn("Could not put back an export lock; it is kept at:", aside, error);
        return;
      }
      exportWarn("An export lock was retaken while this one stood down:", lock, error);
    }
  }
  await removeQuietly(aside);
}
