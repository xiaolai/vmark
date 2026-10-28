/**
 * History Storage
 *
 * Purpose: where a document's history lives on disk, and the single steps that
 *   read and write it — the index file and the snapshot files.
 *
 * Nothing here orders anything. Each function is ONE step of a history
 * operation and is called from inside an operation that `historyQueue` has
 * already put in line; calling one from anywhere else reintroduces the
 * interleaving the queue exists to prevent.
 *
 * Key decisions:
 *   - History stored in appDataDir, not alongside documents (portable)
 *   - One directory per document, named by the hash of its path
 *   - Index file tracks metadata; actual content in one file per snapshot
 *   - The index is replaced by rename, never rewritten in place
 *
 * @coordinates-with historyOperations.ts — the queued operations built from these steps
 * @coordinates-with historyQueue.ts — what makes calling these steps safe
 * @coordinates-with historyTypes.ts — shared types and constants
 * @module services/history/historyStorage
 */

import { mkdir, exists, readTextFile, writeTextFile, rename } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { historyError } from "@/utils/debug";
import {
  type HistoryIndex,
  HISTORY_FOLDER,
  INDEX_FILE,
  hashPath,
  parseHistoryIndex,
} from "@/utils/historyTypes";

/**
 * Get the base history directory path (<app_data>/history/)
 */
export async function getHistoryBaseDir(): Promise<string> {
  const appDir = await appDataDir();
  return join(appDir, HISTORY_FOLDER);
}

/**
 * Get the history directory for a specific document
 */
export async function getDocHistoryDir(documentPath: string): Promise<string> {
  const baseDir = await getHistoryBaseDir();
  const hash = await hashPath(documentPath);
  return join(baseDir, hash);
}

/**
 * Ensure the history directory exists
 */
async function ensureHistoryDir(documentPath: string): Promise<string> {
  const historyDir = await getDocHistoryDir(documentPath);
  if (!(await exists(historyDir))) {
    await mkdir(historyDir, { recursive: true });
  }
  return historyDir;
}

/**
 * Read a document's index. `null` when there is none, or it cannot be read.
 */
export async function readHistoryIndex(documentPath: string): Promise<HistoryIndex | null> {
  try {
    const historyDir = await getDocHistoryDir(documentPath);
    const indexPath = await join(historyDir, INDEX_FILE);

    if (!(await exists(indexPath))) {
      return null;
    }

    const content = await readTextFile(indexPath);
    const index = parseHistoryIndex(JSON.parse(content));
    if (!index) {
      historyError("Invalid index file format");
      return null;
    }
    return index;
  } catch (error) {
    historyError("Failed to read index:", error);
    return null;
  }
}

/**
 * Save the history index: written beside it, then renamed over it, so the
 * index is replaced in one step. Written in place, a failure or crash between
 * the truncate and the data would leave an empty index — every snapshot in
 * the history unreachable. Rejects when either step fails.
 */
export async function saveHistoryIndex(documentPath: string, index: HistoryIndex): Promise<void> {
  const historyDir = await ensureHistoryDir(documentPath);
  const indexPath = await join(historyDir, INDEX_FILE);
  const stagedPath = `${indexPath}.tmp`;
  await writeTextFile(stagedPath, JSON.stringify(index, null, 2));
  await rename(stagedPath, indexPath);
}

/**
 * Read one snapshot's content. `null` when it does not exist or cannot be read.
 */
export async function readSnapshot(documentPath: string, snapshotId: string): Promise<string | null> {
  try {
    const historyDir = await getDocHistoryDir(documentPath);
    const snapshotPath = await join(historyDir, `${snapshotId}.md`);

    if (!(await exists(snapshotPath))) {
      historyError("Snapshot not found:", snapshotId);
      return null;
    }

    return await readTextFile(snapshotPath);
  } catch (error) {
    historyError("Failed to load snapshot:", error);
    return null;
  }
}
