/**
 * Publishing a staged export into its destination — and undoing it.
 *
 * Purpose: the transaction half of `exportStaging.ts`, split out when round 4
 * grew it past the ~300-line rule. The stage owns its lifecycle (lock, root,
 * tracking, cleanup); this module owns the one risky step — moving a finished
 * staging tree over whatever the destination already holds, and putting it all
 * back if a move fails part way (audit 20260907, #334).
 *
 * The shape:
 *   - a destination file the export is about to replace is renamed ASIDE into
 *     `.replaced/` under the staging root first, so it still exists;
 *   - every directory this publish had to create is recorded;
 *   - a failure rolls the completed steps back in reverse — backups restored,
 *     files this export added removed, created directories removed — and the
 *     rejection then says either that the folder was restored or exactly which
 *     paths could not be put back AND where their backups are waiting. Silence
 *     about a half-written folder is the one outcome that is not allowed.
 *
 * Restoring is `rename` first, `copyFile` second, and NEVER remove-then-rename
 * — see `restoreBackup`, which is where the cross-platform reasoning lives.
 *
 * A backup that could not be restored is REPORTED BACK to the stage through
 * `retainedBackups`, because it is then the only copy of a file the user had:
 * the staging tree holding it must outlive the failed export. Round 3 removed
 * that tree unconditionally, which turned a failed restore into the data loss
 * the whole staging design exists to prevent.
 *
 * @coordinates-with src/export/exportStaging.ts — the only consumer
 * @coordinates-with src-tauri/src/atomic_replace.rs — the same Windows rename semantics, one layer down
 * @module export/exportPublish
 */

import { copyFile, exists, lstat, mkdir, remove, rename } from "@tauri-apps/plugin-fs";
import { exportWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

/** Where a replaced destination file waits until the publish completes. */
const REPLACED_DIR = ".replaced";

/** One completed publication step, as its rollback needs to see it. */
interface PublishedStep {
  /** The destination path this step wrote. */
  final: string;
  /** Where the file it replaced is waiting, or undefined if it added a new one. */
  backup?: string;
}

/**
 * Move each tracked file over its final path, keeping enough to undo it.
 *
 * Throws with the rollback's outcome folded into the message. Any backup the
 * rollback could not put back is pushed onto `retainedBackups` — an out
 * parameter because the caller must NOT then delete the staging tree those
 * backups live in.
 */
export async function publishTracked(
  destination: string,
  root: string,
  tracked: readonly string[],
  retainedBackups: string[],
): Promise<void> {
  const done: PublishedStep[] = [];
  const createdDirs: string[] = [];
  const ensured = new Set<string>([destination]);

  try {
    for (const relative of tracked) {
      const final = `${destination}/${relative}`;
      const parent = parentOf(final);
      if (!ensured.has(parent)) {
        const before = createdDirs.length;
        await ensureDir(parent, destination, createdDirs);
        for (const dir of createdDirs.slice(before)) ensured.add(dir);
        ensured.add(parent);
      }

      if (await exists(final)) {
        // A DIRECTORY where this export wants a file is not something to move
        // aside: the aside lives in the staging tree, which is removed whole
        // on success, so the whole subtree would go with it and the user would
        // never be told (audit 20260907 round 2). `exists` cannot tell the two
        // apart; refuse instead, and let the rollback below put back
        // everything published so far. `lstat`, not `stat`: a symlink TO a
        // directory is renamed as the link, so only the link is at stake.
        if ((await lstat(final)).isDirectory) {
          throw new Error(
            `${final} is a directory, not a file this export may replace. ` +
              "Move or rename it, or export to a different folder.",
          );
        }
        // Aside, not away: a `rename` over it would destroy the previous
        // export's file with nothing left to put back (#334).
        const backup = `${root}/${REPLACED_DIR}/${relative}`;
        await mkdir(parentOf(backup), { recursive: true });
        await rename(final, backup);
        // Recorded BEFORE the move in: if that move fails, `final` is empty
        // and the backup is the only copy — the rollback has to know about it.
        done.push({ final, backup });
        await rename(`${root}/${relative}`, final);
      } else {
        await rename(`${root}/${relative}`, final);
        done.push({ final });
      }
    }
  } catch (error) {
    const undone = await rollback(done, createdDirs, retainedBackups);
    throw new Error(
      `Export to ${destination} could not be published: ${errorMessage(error)}. ` +
        describeRollback(undone),
      // The message already quotes the cause; attach it too, so a caller that
      // inspects the chain (rather than reading prose) can still reach it.
      { cause: error },
    );
  }
}

/** What a rollback could NOT put back: `path (reason)` files, then dirs. */
interface RollbackFailures {
  files: string[];
  dirs: string[];
}

/**
 * The half of the rejection that says what state the destination is in.
 *
 * A leftover DIRECTORY only gets its own sentence when every file went back:
 * "restored to its previous contents" was said while empty directories this
 * export had created were still standing (audit R2, #675). When a file could
 * not be restored the message already says the folder is not as it was, and
 * the directory holding that file cannot be removed either — so naming it
 * there would report one failure twice.
 */
function describeRollback({ files, dirs }: RollbackFailures): string {
  if (files.length > 0) return `These files could not be restored: ${files.join(", ")}.`;
  if (dirs.length > 0) {
    return `Your files were restored, but these folders the export created are still there: ${dirs.join(", ")}.`;
  }
  return "Nothing else was changed — the folder was restored to its previous contents.";
}

/**
 * Undo `done` in reverse, then remove the directories the publish created.
 *
 * Returns `path (reason)` for every step it could NOT undo, and pushes the
 * backup of each such step onto `retainedBackups`. A rollback that fails is
 * the case the user most needs told about, so it is collected rather than
 * thrown on: one unrestorable file must not hide the rest.
 */
async function rollback(
  done: readonly PublishedStep[],
  createdDirs: readonly string[],
  retainedBackups: string[],
): Promise<RollbackFailures> {
  const files: string[] = [];
  for (const step of [...done].reverse()) {
    const { final, backup } = step;
    try {
      if (backup === undefined) await remove(final);
      else await restoreBackup(backup, final);
    } catch (error) {
      if (backup === undefined) {
        files.push(`${final} (${errorMessage(error)})`);
      } else if (await isThere(backup, true)) {
        // Naming the backup is the difference between a recoverable failure
        // and a lost file, so the stage is told to keep it (#334). Only a
        // CONFIRMED absence takes that away — discarding is irreversible.
        retainedBackups.push(backup);
        files.push(
          `${final} (its previous contents are kept at ${backup}: ${errorMessage(error)})`,
        );
      } else {
        // The restore failed BECAUSE the backup is gone — interference, or a
        // duplicate path that moved it. "Kept at <path>" would send the user
        // to a file that is not there (audit R2, #674).
        files.push(`${final} (its backup at ${backup} is gone too: ${errorMessage(error)})`);
      }
    }
  }
  // Deepest first, and non-recursive: this removes a directory the publish
  // created and has just emptied, and refuses one still holding a file the
  // step above could not remove — which is content, not this export's litter.
  const dirs: string[] = [];
  for (const dir of [...createdDirs].reverse()) {
    if (!(await removeQuietly(dir))) dirs.push(dir);
  }
  return { files, dirs };
}

/**
 * Put the file backed up at `backup` back over `final`.
 *
 * `rename` first: it is atomic, it keeps the file's identity, and it REPLACES
 * an existing target on BOTH platforms. That was worth establishing rather
 * than assuming — `@tauri-apps/plugin-fs`'s `rename` command is
 * `std::fs::rename`, which is `rename(2)` on Unix and, on Windows,
 * `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` (falling back to
 * `SetFileInformationByHandle` with `FILE_RENAME_FLAG_REPLACE_IF_EXISTS`).
 * "Windows rename fails when the target exists" is a myth this repository has
 * already refuted once, at `src-tauri/src/atomic_replace.rs`.
 *
 * What Windows really does is REFUSE the move while another handle holds the
 * file being replaced: `MoveFileExW` needs delete access, and an antivirus
 * scanner, a backup agent or a reader is enough to make it fail with
 * ERROR_ACCESS_DENIED. CI's Windows leg hit exactly that. So there is a
 * fallback, and it is `copyFile` — `std::fs::copy` overwrites the target's
 * CONTENTS and needs no delete access at all.
 *
 * Deliberately NOT remove-then-rename, which is the obvious fallback and is
 * wrong: this repository removed precisely that as a data-loss defect (audit
 * 20260906, B1) because it takes the target away first, so a second failure
 * leaves nothing behind. `copyFile` leaves the backup whole whether it
 * succeeds or fails, so the caller always has a file to name.
 */
async function restoreBackup(backup: string, final: string): Promise<void> {
  try {
    await rename(backup, final);
    return;
  } catch (error) {
    exportWarn("Restoring an export backup by rename was refused:", final, error);
  }
  await copyFile(backup, final);
}

/**
 * Create `dir` if it is absent, appending every directory this call actually
 * brought into existence to `created`, shallowest first.
 *
 * `mkdir --recursive` creates missing ANCESTORS too, and a rollback that
 * removed only the leaf would leave them behind (#335), so they are walked
 * explicitly. The walk stops at `destination`, which this export does not own.
 *
 * Each level is then created SEPARATELY and recorded only once its own `mkdir`
 * has returned (audit R2, #676). One recursive call recorded the whole chain on
 * success and nothing on failure, so a call that made two of three levels
 * before failing left both behind untracked — and a level another export
 * created meanwhile was recorded as this one's and removed from under it during
 * rollback. `created` is an OUT parameter for the same reason: a throw part way
 * through must leave the levels already made visible to the rollback.
 */
async function ensureDir(dir: string, destination: string, created: string[]): Promise<void> {
  if (await exists(dir)) return;
  const missing: string[] = [];
  let cursor = dir;
  while (cursor.startsWith(`${destination}/`) && !(await exists(cursor))) {
    missing.unshift(cursor);
    cursor = parentOf(cursor);
  }
  for (const level of missing) {
    try {
      await mkdir(level);
    } catch (error) {
      // It appeared between the walk and this call: another export, or the
      // user. Not this publish's to record, and so not its to remove. Asked of
      // the filesystem, never of the error's per-platform wording — and an
      // unanswerable `exists` raises the failure rather than swallowing it.
      if (!(await isThere(level, false))) throw error;
      continue;
    }
    created.push(level);
  }
}

/**
 * Whether `path` is there. `whenUnknown` answers for an `exists` that itself
 * failed, and the two callers want opposite defaults: KEEP a backup that may
 * still hold the user's file, RAISE a `mkdir` failure that may be real.
 */
const isThere = (path: string, whenUnknown: boolean): Promise<boolean> =>
  exists(path).catch(() => whenUnknown);

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/**
 * Remove `path`, logging rather than failing: no export outcome depends on
 * cleanup succeeding. Answers whether it is gone, so a caller that must not
 * CLAIM it removed something can tell (#675). One wrapper, two call sites —
 * the catch-and-warn shape was written twice (audit R3 #677).
 */
async function removeLogging(path: string, recursive: boolean, warning: string): Promise<boolean> {
  try {
    await remove(path, { recursive });
    return true;
  } catch (error) {
    exportWarn(warning, path, error);
    return false;
  }
}

/** Remove a staging tree; a failure is logged, not raised. */
export async function removeTree(root: string): Promise<void> {
  await removeLogging(root, true, "Could not remove the export staging tree:");
}

/** Remove one empty directory or file. Answers whether it is gone (#675). */
export const removeQuietly = (path: string): Promise<boolean> =>
  removeLogging(path, false, "Could not remove an export path it created:");
