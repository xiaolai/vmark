/**
 * History Files
 *
 * Purpose: the snapshot-file steps of a history operation that are not plain
 *   reads or writes — choosing a new snapshot's id, and removing the files an
 *   index no longer names.
 *
 * Like historyStorage, nothing here orders anything: each function is a step
 * of an operation `historyQueue` has already put in line.
 *
 * Key decisions:
 *   - An id names its file, so a new id must be free both in the index and on
 *     disk; writing under a taken id would overwrite another snapshot and
 *     leave two index entries sharing one file
 *   - Unreferenced files are removed only AFTER the index that drops them is
 *     saved, and best-effort: a file left behind is merely orphaned
 *
 * @coordinates-with historyOperations.ts — the operations these steps serve
 * @coordinates-with historyTypes.ts — the id alphabet the parser accepts
 * @module services/history/historyFiles
 */

import { exists, remove } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { historyLog } from "@/utils/debug";
import type { HistoryIndex } from "@/utils/historyTypes";

/** Draws before giving up — reaching it means the random source is broken. */
const MAX_ID_ATTEMPTS = 8;

/**
 * A snapshot id no entry of `index` and no file in `historyDir` holds:
 * the millisecond `timestamp`, `-`, and a random UUID (lowercase hex and `-`,
 * inside the parser's 64-character alphabet). Throws when every draw is taken.
 */
export async function allocateSnapshotId(
  historyDir: string,
  index: HistoryIndex,
  timestamp: number
): Promise<{ id: string; path: string }> {
  const taken = new Set(index.snapshots.map((s) => s.id));
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const id = `${timestamp}-${globalThis.crypto.randomUUID()}`;
    if (taken.has(id)) continue;
    const path = await join(historyDir, `${id}.md`);
    if (!(await exists(path))) return { id, path };
  }
  throw new Error(`No free snapshot id after ${MAX_ID_ATTEMPTS} attempts`);
}

/**
 * Best-effort removal of snapshot files the written index no longer names.
 * Runs only AFTER that index is saved, so a failed index write never leaves
 * an entry whose file is gone; a file left behind here is merely orphaned.
 */
export async function removeUnreferenced(historyDir: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    try {
      const path = await join(historyDir, `${id}.md`);
      if (await exists(path)) await remove(path);
    } catch {
      historyLog("Could not remove unreferenced snapshot file:", id);
    }
  }
}
