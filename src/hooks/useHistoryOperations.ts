/**
 * History Operations (Hooks Layer)
 *
 * Purpose: Async CRUD for document version history — creating snapshots,
 *   loading past versions, deleting individual snapshots, pruning old entries,
 *   and managing the index file.
 *
 * Pipeline: Save triggers → createSnapshot(filePath, content) → file size guard
 *   → merge window check → write to appDataDir/history/{hash}/ → update index.json
 *   → prune if over limit
 *
 * Key decisions:
 *   - Lives in hooks/ (not utils/) because it uses Tauri filesystem APIs
 *   - History stored in appDataDir, not alongside documents (portable)
 *   - Index file tracks metadata; actual content in numbered snapshot files
 *   - Pruning respects HistorySettings (max count, max age)
 *   - Merge window consolidates consecutive auto-saves into one snapshot
 *   - File size guard skips snapshots for oversized files before any I/O
 *
 * @coordinates-with historyTypes.ts — shared types and constants
 * @coordinates-with useHistoryRecovery.ts — recovery of deleted document history
 * @module hooks/useHistoryOperations
 */

import {
  mkdir,
  exists,
  readTextFile,
  writeTextFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { historyLog } from "@/utils/debug";
import {
  type Snapshot,
  type HistoryIndex,
  type HistorySettings,
  HISTORY_FOLDER,
  INDEX_FILE,
  generatePreview,
  getByteSize,
  getDocumentName,
  hashPath,
} from "@/utils/historyTypes";

// Re-export types for consumers
export type { Snapshot, HistoryIndex, HistorySettings };

// Path helpers

/**
 * Get the base history directory path (<app_data>/history/)
 */
async function getHistoryBaseDir(): Promise<string> {
  const appDir = await appDataDir();
  return join(appDir, HISTORY_FOLDER);
}

/**
 * Get the history directory for a specific document
 */
async function getDocHistoryDir(documentPath: string): Promise<string> {
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

// Index operations

/**
 * Get or create the index for a document
 */
export async function getHistoryIndex(
  documentPath: string
): Promise<HistoryIndex | null> {
  try {
    const historyDir = await getDocHistoryDir(documentPath);
    const indexPath = await join(historyDir, INDEX_FILE);

    if (!(await exists(indexPath))) {
      return null;
    }

    const content = await readTextFile(indexPath);
    return JSON.parse(content) as HistoryIndex;
  } catch (error) {
    console.error("[History] Failed to read index:", error);
    return null;
  }
}

/**
 * Save the history index
 */
async function saveHistoryIndex(
  documentPath: string,
  index: HistoryIndex
): Promise<void> {
  const historyDir = await ensureHistoryDir(documentPath);
  const indexPath = await join(historyDir, INDEX_FILE);
  await writeTextFile(indexPath, JSON.stringify(index, null, 2));
}

// Snapshot operations

/**
 * Create a new snapshot of the document
 */
export async function createSnapshot(
  documentPath: string,
  content: string,
  type: "manual" | "auto" | "revert",
  settings: HistorySettings
): Promise<void> {
  try {
    // File size guard — only for auto-saves; manual/revert always create a safety snapshot
    if (type === "auto" && settings.maxFileSizeKB > 0) {
      const sizeKB = getByteSize(content) / 1024;
      if (sizeKB > settings.maxFileSizeKB) {
        historyLog(
          "Skipping snapshot — file size",
          Math.round(sizeKB),
          "KB exceeds limit",
          settings.maxFileSizeKB,
          "KB"
        );
        return;
      }
    }

    // Compute hash and ensure dir in one pass (avoids double hashPath)
    const baseDir = await getHistoryBaseDir();
    const hash = await hashPath(documentPath);
    const historyDir = await join(baseDir, hash);
    if (!(await exists(historyDir))) {
      await mkdir(historyDir, { recursive: true });
    }

    // Get or create index
    let index = await getHistoryIndex(documentPath);
    if (!index) {
      index = {
        documentPath,
        documentName: getDocumentName(documentPath),
        pathHash: hash,
        status: "active",
        deletedAt: null,
        snapshots: [],
        settings,
      };
    }

    const timestamp = Date.now();

    // Merge window — replace last auto snapshot if within window
    if (
      type === "auto" &&
      settings.mergeWindowSeconds > 0 &&
      index.snapshots.length > 0
    ) {
      // Sort to ensure we check the actual newest snapshot (defensive against corruption)
      index.snapshots.sort((a, b) => a.timestamp - b.timestamp);
      const lastSnapshot = index.snapshots[index.snapshots.length - 1];
      const windowMs = settings.mergeWindowSeconds * 1000;
      if (
        lastSnapshot.type === "auto" &&
        timestamp >= lastSnapshot.timestamp &&
        timestamp - lastSnapshot.timestamp <= windowMs
      ) {
        const oldPath = await join(historyDir, `${lastSnapshot.id}.md`);
        try {
          if (await exists(oldPath)) await remove(oldPath);
          // Only pop if deletion succeeded — avoid orphaning the index reference
          index.snapshots.pop();
          historyLog("Merged with previous auto snapshot:", lastSnapshot.id);
        } catch {
          historyLog("Merge cleanup failed, keeping both snapshots:", lastSnapshot.id);
        }
      }
    }

    // Create snapshot with unique ID (timestamp + random suffix for collision safety)
    const snapshotId = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const snapshotPath = await join(historyDir, `${snapshotId}.md`);

    // Write snapshot content
    await writeTextFile(snapshotPath, content);

    // Update index
    const snapshot: Snapshot = {
      id: snapshotId,
      timestamp,
      type,
      size: content.length,
      preview: generatePreview(content),
    };

    index.snapshots.push(snapshot);
    index.status = "active";
    index.deletedAt = null;
    index.settings = settings;

    // Save index
    await saveHistoryIndex(documentPath, index);

    // Prune old snapshots
    await pruneSnapshots(documentPath);

    historyLog(`Created ${type} snapshot:`, snapshotId);
  } catch (error) {
    console.error("[History] Failed to create snapshot:", error);
    throw error;
  }
}

/**
 * Get list of snapshots for a document
 */
export async function getSnapshots(documentPath: string): Promise<Snapshot[]> {
  const index = await getHistoryIndex(documentPath);
  if (!index) return [];
  // Return sorted by timestamp descending (newest first)
  return [...index.snapshots].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Load a specific snapshot's content
 */
export async function loadSnapshot(
  documentPath: string,
  snapshotId: string
): Promise<string | null> {
  try {
    const historyDir = await getDocHistoryDir(documentPath);
    const snapshotPath = await join(historyDir, `${snapshotId}.md`);

    if (!(await exists(snapshotPath))) {
      console.error("[History] Snapshot not found:", snapshotId);
      return null;
    }

    return await readTextFile(snapshotPath);
  } catch (error) {
    console.error("[History] Failed to load snapshot:", error);
    return null;
  }
}

/**
 * Revert to a snapshot (creates a new snapshot of current state first)
 */
export async function revertToSnapshot(
  documentPath: string,
  snapshotId: string,
  currentContent: string,
  settings: HistorySettings
): Promise<string | null> {
  // Save current state before reverting
  await createSnapshot(documentPath, currentContent, "revert", settings);

  // Load the target snapshot
  return await loadSnapshot(documentPath, snapshotId);
}

/**
 * Clean up old snapshots based on settings
 *
 * Pruning strategy:
 * 1. Remove snapshots older than maxAgeDays
 * 2. Keep only the newest maxSnapshots from what remains
 */
export async function pruneSnapshots(documentPath: string): Promise<void> {
  try {
    const index = await getHistoryIndex(documentPath);
    if (!index || index.snapshots.length === 0) return;

    const { maxSnapshots, maxAgeDays } = index.settings;
    const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const historyDir = await getDocHistoryDir(documentPath);

    // Step 1: Filter out snapshots older than cutoff
    const withinAge = index.snapshots.filter((s) => s.timestamp >= cutoffTime);

    // Step 2: Sort by timestamp descending and keep only newest maxSnapshots
    const sorted = [...withinAge].sort((a, b) => b.timestamp - a.timestamp);
    const toKeep = sorted.slice(0, maxSnapshots);
    const toKeepIds = new Set(toKeep.map((s) => s.id));

    // Step 3: Identify snapshots to remove
    const toRemove = index.snapshots.filter((s) => !toKeepIds.has(s.id));

    // Delete snapshot files
    for (const snapshot of toRemove) {
      try {
        const snapshotPath = await join(historyDir, `${snapshot.id}.md`);
        if (await exists(snapshotPath)) {
          await remove(snapshotPath);
        }
      } catch {
        // Ignore deletion errors for individual snapshots
      }
    }

    // Update index with kept snapshots (maintain original order)
    index.snapshots = index.snapshots.filter((s) => toKeepIds.has(s.id));
    await saveHistoryIndex(documentPath, index);

    if (toRemove.length > 0) {
      historyLog(`Pruned ${toRemove.length} old snapshots`);
    }
  } catch (error) {
    console.error("[History] Failed to prune snapshots:", error);
  }
}

/**
 * Mark a document as deleted (preserves history for recovery)
 */
export async function markAsDeleted(documentPath: string): Promise<void> {
  try {
    const index = await getHistoryIndex(documentPath);
    if (!index) return;

    index.status = "deleted";
    index.deletedAt = Date.now();
    await saveHistoryIndex(documentPath, index);

    historyLog("Marked as deleted:", documentPath);
  } catch (error) {
    console.error("[History] Failed to mark as deleted:", error);
  }
}

/**
 * Delete a single snapshot from a document's history
 */
export async function deleteSnapshot(
  documentPath: string,
  snapshotId: string
): Promise<void> {
  try {
    const index = await getHistoryIndex(documentPath);
    if (!index) return;

    const snapshotIndex = index.snapshots.findIndex((s) => s.id === snapshotId);
    if (snapshotIndex === -1) return;

    // Delete snapshot file (tolerate missing)
    try {
      const historyDir = await getDocHistoryDir(documentPath);
      const snapshotPath = await join(historyDir, `${snapshotId}.md`);
      await remove(snapshotPath);
    } catch {
      // File may already be missing — continue to update index
    }

    // Remove from index and save
    index.snapshots.splice(snapshotIndex, 1);
    await saveHistoryIndex(documentPath, index);

    historyLog("Deleted snapshot:", snapshotId);
  } catch (error) {
    console.error("[History] Failed to delete snapshot:", error);
  }
}

// Export the base dir getter for recovery operations
export { getHistoryBaseDir };
