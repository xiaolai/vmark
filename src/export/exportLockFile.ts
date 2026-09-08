/**
 * The export lock FILE: its shape, and the four filesystem questions asked of
 * it.
 *
 * Purpose: split out of `exportLock.ts` (round 5) so the two things that module
 * does — hand out and give back a lock, and wrest one from a dead holder — each
 * read on their own. Everything here is about the file rather than the
 * protocol: what it contains, how it is written exclusively, and what an OS
 * failure means.
 *
 * @coordinates-with src/export/exportLock.ts — acquire / release / holds
 * @coordinates-with src/export/exportLockTakeover.ts — the stale-takeover protocol
 * @module export/exportLockFile
 */

import { exists, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { exportWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

/** The lock file's name inside the destination folder. */
export const EXPORT_LOCK_NAME = ".vmark-export.lock";

/** A lock older than this belonged to a window that died; it is taken over. */
export const EXPORT_LOCK_STALE_MS = 5 * 60_000;

/** What the lock file holds — enough to age it and to own it, nothing else. */
export interface LockContents {
  acquiredAt: number;
  /** The acquiring export's nonce; only that export may release this lock. */
  owner: string;
}

/** The lock file guarding `destination`. */
export function exportLockPath(destination: string): string {
  return `${destination}/${EXPORT_LOCK_NAME}`;
}

export async function writeLock(
  lock: string,
  owner: string,
  options?: { createNew: true },
): Promise<void> {
  const contents: LockContents = { acquiredAt: Date.now(), owner };
  await writeTextFile(lock, JSON.stringify(contents), options);
}

export function parseLock(text: string): Partial<LockContents> | null {
  try {
    return JSON.parse(text) as Partial<LockContents>;
  } catch {
    return null;
  }
}

/** Whether `path` is still there; an unanswerable question counts as YES. */
export const stillThere = (path: string): Promise<boolean> => exists(path).catch(() => true);

/** The file's text, or null when it is gone or unreadable. */
export async function readQuietly(path: string): Promise<string | null> {
  try {
    return await readTextFile(path);
  } catch {
    return null;
  }
}

export async function removeQuietly(path: string): Promise<void> {
  try {
    await remove(path);
  } catch (error) {
    exportWarn("Could not remove an export lock file:", path, error);
  }
}

/**
 * The three ways an OS says "that path is already there".
 *
 * Matched on the message because the plugin surfaces a string: Tauri's fs
 * plugin reports the OS error, so this is `EEXIST` on some platforms, "File
 * exists (os error 17)" on Unix and "Cannot create a file when that file
 * already exists. (os error 183)" on Windows.
 *
 * Matched on the WHOLE phrase, never on "exist" alone (round 5, #667). "does
 * not exist" contains that substring, so a missing parent directory — a real,
 * immediate failure — was classified as contention: the acquire loop then spent
 * its entire 30-second wait on it and blamed a second export that never
 * existed, against this module's own rule that only contention waits.
 */
const ALREADY_EXISTS_RE = /\bEEXIST\b|\balready exists?\b|\bfile exists\b/i;

/** Whether a write failed because the path was already there. */
export function isAlreadyExists(error: unknown): boolean {
  return ALREADY_EXISTS_RE.test(errorMessage(error));
}

/**
 * A value no other export will produce, for a name no other export will pick.
 *
 * Lives beside the lock because the lock's CORRECTNESS rests on it — an owner
 * two exports could both produce is not an owner. `exportStaging` names its
 * staging root with the same primitive and had a byte-identical copy, which is
 * one filesystem-safety primitive with two places to get wrong (round 5, #684).
 */
export function nonce(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return c?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
