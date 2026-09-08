/**
 * Export staging — a transactional publish for folder exports (audit
 * 20260907, #332/#334/#335).
 *
 * Purpose: `exportHtml` used to write straight into the destination folder
 * and, on failure, delete every path it had written. A re-export over a
 * previous export OVERWROTE index.html, the reader assets and the images
 * first and then, when a later write failed, deleted them — the previous
 * export destroyed rather than restored (#334). And two exports to one
 * folder — two windows can each run one — raced on the same file names, and
 * the failing one's cleanup removed the other's output (#332).
 *
 * The shape here is crash recovery's (`crashRecovery.ts`): write EVERYTHING
 * under a private staging directory inside the destination, publish each
 * file by `rename` over its final path — a replace, never a delete — and
 * remove the staging tree. A failure before publish removes only the staging
 * tree; nothing pre-existing is touched.
 *
 * This module owns the stage's LIFECYCLE; `exportPublish.ts` owns the publish
 * transaction and its rollback, which is where the interesting failure
 * reasoning lives.
 *
 * Two things every path through here has to hold, both learned by getting
 * them wrong in round 3:
 *   - **The lock is released on every exit.** It is taken before the staging
 *     root is made, so a failure there left it behind and the folder was
 *     un-exportable until the stale timeout five minutes later (#335). The
 *     acquire-to-return span is therefore wrapped: either a stage owns the
 *     lock, or this function has released it.
 *   - **A backup that could not be restored outlives the export.** `discard`
 *     removes the staging tree, and the backups of files the publish replaced
 *     live IN that tree — so removing it after a failed rollback deleted the
 *     user's only copy, which is the data loss the staging design exists to
 *     prevent (#334). `retainedBackups` is how the publish says so.
 *
 * Concurrency has two layers, because one is not enough: `runExclusive`
 * serializes exports within a webview, and `exportLock` takes a lock FILE in
 * the destination so a second window cannot publish into the same folder
 * (#332) — a JS queue is per-webview and VMark opens a window per document.
 *
 * Staging INSIDE the destination, not in the OS temp dir, so the rename
 * never crosses a device — the one case where `rename` degrades to a copy.
 *
 * @coordinates-with src/export/htmlExport.ts — the only consumer
 * @coordinates-with src/export/exportPublish.ts — the publish transaction and its rollback
 * @coordinates-with src/export/exportLock.ts — the cross-window destination lock
 * @coordinates-with src/services/persistence/crashRecovery.ts — the same publish-by-rename idiom
 * @module export/exportStaging
 */

import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { acquireExportLock, holdsExportLock, nonce, releaseExportLock } from "./exportLock";
import { publishTracked, removeQuietly, removeTree } from "./exportPublish";

export {
  EXPORT_LOCK_NAME,
  EXPORT_LOCK_STALE_MS,
  EXPORT_LOCK_WAIT_MS,
} from "./exportLock";

/** A staging tree for one export, published by rename or discarded whole. */
export interface ExportStage {
  /** The staging root — hand it to the resolver as `outputDir`; write files under it. */
  readonly root: string;
  /**
   * The staging path of a destination-relative file (`assets/vmark-reader.css`).
   * Throws on anything that is not a contained relative path — see `relativePath`.
   */
  path(relative: string): string;
  /**
   * Record a destination-relative file that now exists under the staging root.
   * Throws on an escaping, reserved or duplicate path — publication renames
   * each tracked entry over `<destination>/<relative>`, so an unchecked one
   * writes outside the folder the user chose, and a duplicate overwrites the
   * backup of the file it replaced (audit 20260907 round 2).
   */
  track(relative: string): void;
  /**
   * Move every tracked file over its final path — parent directories created
   * as needed, each move a replace — then remove the staging tree and release
   * the destination lock. Rejects without touching the destination if this
   * export no longer holds the lock; a failure part way through rolls every
   * completed step back and rejects with what it could and could not restore.
   */
  publish(): Promise<void>;
  /**
   * Release the lock and remove the staging tree, plus the destination folder
   * if this stage created it (it is still empty). Pre-existing content is
   * never touched — and the staging tree STAYS when a failed publish left the
   * only copy of a replaced file inside it.
   */
  discard(): Promise<void>;
}

/** Open a stage inside `destination`, creating the destination when absent. */
export async function openStage(destination: string): Promise<ExportStage> {
  const createdDestination = !(await exists(destination));
  if (createdDestination) await mkdir(destination, { recursive: true });

  let owner: string;
  try {
    owner = await acquireExportLock(destination);
  } catch (error) {
    // An export that never started leaves nothing behind, the folder it just
    // made included (#335) — otherwise a contended destination accumulates
    // empty directories from every attempt.
    if (createdDestination) await removeQuietly(destination);
    throw error;
  }

  try {
    return await stageUnder(destination, owner, createdDestination);
  } catch (error) {
    // Every path out of this function either returns a stage that owns the
    // lock or gives it back here (#335). The lock file lives inside the
    // destination, so it goes first or the folder cannot be removed.
    await releaseExportLock(destination, owner);
    if (createdDestination) await removeQuietly(destination);
    throw error;
  }
}

/** Build the stage itself. The caller holds the lock and cleans up on a throw. */
async function stageUnder(
  destination: string,
  owner: string,
  createdDestination: boolean,
): Promise<ExportStage> {
  const root = `${destination}/.vmark-export-${nonce()}`;
  await mkdir(root, { recursive: true });

  const tracked = new Set<string>();
  /**
   * Backups a failed publish could not put back. Non-empty means the staging
   * tree holds the only copy of a file the user had, so it must survive.
   */
  const retainedBackups: string[] = [];

  return {
    root,
    path: (relative) => `${root}/${relativePath(relative)}`,
    track: (relative) => {
      const key = relativePath(relative);
      // A Set, not an array: publishing one path twice renames the FIRST
      // step's backup — the user's own file — out from under itself, and the
      // rollback then restores this export's output over it. That is the data
      // loss the whole staging design exists to prevent, so a repeat is
      // simply the same file (audit 20260907 round 2).
      tracked.add(key);
    },
    publish: async () => {
      // The lock is advisory: a holder that outlives the stale threshold can
      // have it taken over. Publishing without it would interleave two
      // windows' files in one folder, which is the only thing the lock is for
      // — so refuse, and let the caller discard this tree (#332). It shrinks
      // the exposure from the whole export down to the publish itself.
      if (!(await holdsExportLock(destination, owner))) {
        throw new Error(
          `Export to ${destination} was not published: another export took over ` +
            "the folder while this one was running. Nothing at the destination was changed.",
        );
      }
      await publishTracked(destination, root, [...tracked], retainedBackups);
      await removeTree(root);
      await releaseExportLock(destination, owner);
    },
    discard: async () => {
      if (retainedBackups.length === 0) await removeTree(root);
      await releaseExportLock(destination, owner);
      // Non-recursive on purpose: it removes the empty folder this export
      // made and refuses one that has since gained content.
      if (createdDestination && retainedBackups.length === 0) {
        await removeQuietly(destination);
      }
    },
  };
}

/**
 * The one gate on what a stage may address: a destination-relative path with
 * no way out of the destination and no way onto this module's own files.
 *
 * Publication is `rename(stage/<relative>, destination/<relative>)`, so the
 * string decides where the export writes. Today's caller only ever passes its
 * own constants plus an image BASENAME, but `ExportStage` is an interface
 * other code may reach for, and the failure it would buy is silent: a `..`
 * segment publishes OUTSIDE the folder the user chose, and `.vmark-export.lock`
 * publishes over the live destination lock. Rejected LOUDLY rather than
 * sanitized — a caller asking for a path it cannot have has a bug, and
 * quietly rewriting it would export a file the caller never named.
 *
 * A backslash is READ as a separator — Rust accepts either on Windows, so
 * `..\\x` escapes exactly like `../x` there — but the string is returned
 * UNCHANGED, never re-joined: on macOS a backslash is an ordinary character in a
 * filename, and normalizing `we\\ird.png` into a directory would send the publish
 * looking for a path nothing staged. Validation only; no rewriting.
 */
function relativePath(relative: string): string {
  const segments = relative.split(/[/\\]/);
  const bad =
    segments.some((s) => s === "" || s === "." || s === ".." || s.startsWith(".vmark-export")) ||
    /^[a-zA-Z]:/.test(relative);
  if (bad) {
    throw new Error(
      `Export path ${JSON.stringify(relative)} is not a contained relative path ` +
        "(empty, absolute, dot segment, or a reserved .vmark-export name).",
    );
  }
  return relative;
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Run `task` after every earlier task queued under `key` has settled, so
 * exports to one destination never interleave. Tasks under different keys
 * run concurrently. A task's rejection reaches its own caller only; the
 * queue itself never rejects.
 *
 * This is the WEBVIEW-local half of the guarantee; the destination lock in
 * `exportLock.ts` is what makes it hold across windows.
 */
export async function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(key) ?? Promise.resolve();
  const run = previous.then(task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  inFlight.set(key, settled);
  try {
    return await run;
  } finally {
    if (inFlight.get(key) === settled) inFlight.delete(key);
  }
}
