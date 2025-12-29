/**
 * Document History Utilities
 *
 * Manages document version history stored in a global location (~/.vmark/history/)
 * that survives file deletion and enables recovery.
 */

import {
  mkdir,
  exists,
  readTextFile,
  writeTextFile,
  readDir,
  remove,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

// Types

export interface Snapshot {
  id: string; // Timestamp as string
  timestamp: number;
  type: "manual" | "auto" | "revert";
  size: number;
  preview: string;
}

export interface HistoryIndex {
  documentPath: string;
  documentName: string;
  pathHash: string;
  status: "active" | "deleted" | "orphaned";
  deletedAt: number | null;
  snapshots: Snapshot[];
  settings: {
    maxSnapshots: number;
    maxAgeDays: number;
  };
}

export interface DeletedDocument {
  pathHash: string;
  documentName: string;
  lastPath: string;
  deletedAt: number;
  snapshotCount: number;
  latestPreview: string;
}

// Constants

const HISTORY_FOLDER = "history";
const INDEX_FILE = "index.json";
const PREVIEW_LENGTH = 200;

// Helper functions

/**
 * Generate a 16-character hex hash from a document path
 */
async function hashPath(documentPath: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(documentPath);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Get the base history directory path (~/.vmark/history/)
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

/**
 * Generate a preview from content (first N characters)
 */
function generatePreview(content: string): string {
  return content.slice(0, PREVIEW_LENGTH).replace(/\n/g, " ").trim();
}

/**
 * Get the document name from a path
 */
function getDocumentName(documentPath: string): string {
  return documentPath.split("/").pop() || "Untitled";
}

// Core functions

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

/**
 * Create a new snapshot of the document
 */
export async function createSnapshot(
  documentPath: string,
  content: string,
  type: "manual" | "auto" | "revert",
  settings: { maxSnapshots: number; maxAgeDays: number }
): Promise<void> {
  try {
    const historyDir = await ensureHistoryDir(documentPath);
    const hash = await hashPath(documentPath);

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

    // Create snapshot
    const timestamp = Date.now();
    const snapshotId = timestamp.toString();
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

    console.log(`[History] Created ${type} snapshot:`, snapshotId);
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
 *
 * @public Exported for external use: snapshot preview, diff view,
 * testing, and potential future features like side-by-side comparison.
 * Currently used internally by revertToSnapshot.
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
  settings: { maxSnapshots: number; maxAgeDays: number }
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
      console.log(`[History] Pruned ${toRemove.length} old snapshots`);
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

    console.log("[History] Marked as deleted:", documentPath);
  } catch (error) {
    console.error("[History] Failed to mark as deleted:", error);
  }
}

/**
 * Get all deleted documents that have history
 */
export async function getDeletedDocuments(): Promise<DeletedDocument[]> {
  try {
    const baseDir = await getHistoryBaseDir();
    if (!(await exists(baseDir))) return [];

    const entries = await readDir(baseDir);
    const deleted: DeletedDocument[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      try {
        const indexPath = await join(baseDir, entry.name, INDEX_FILE);
        if (!(await exists(indexPath))) continue;

        const content = await readTextFile(indexPath);
        const index = JSON.parse(content) as HistoryIndex;

        if (index.status === "deleted" && index.snapshots.length > 0) {
          const latestSnapshot = index.snapshots[index.snapshots.length - 1];
          deleted.push({
            pathHash: index.pathHash,
            documentName: index.documentName,
            lastPath: index.documentPath,
            deletedAt: index.deletedAt || 0,
            snapshotCount: index.snapshots.length,
            latestPreview: latestSnapshot.preview,
          });
        }
      } catch {
        // Skip invalid entries
      }
    }

    // Sort by deletion date descending
    return deleted.sort((a, b) => b.deletedAt - a.deletedAt);
  } catch (error) {
    console.error("[History] Failed to get deleted documents:", error);
    return [];
  }
}

/**
 * Restore a deleted document's latest version to a new path
 */
export async function restoreDeletedDocument(
  pathHash: string,
  newPath: string
): Promise<string | null> {
  try {
    const baseDir = await getHistoryBaseDir();
    const historyDir = await join(baseDir, pathHash);
    const indexPath = await join(historyDir, INDEX_FILE);

    if (!(await exists(indexPath))) {
      console.error("[History] No history found for hash:", pathHash);
      return null;
    }

    const content = await readTextFile(indexPath);
    const index = JSON.parse(content) as HistoryIndex;

    if (index.snapshots.length === 0) {
      console.error("[History] No snapshots to restore");
      return null;
    }

    // Get latest snapshot
    const latestSnapshot = index.snapshots[index.snapshots.length - 1];
    const snapshotPath = await join(historyDir, `${latestSnapshot.id}.md`);
    const snapshotContent = await readTextFile(snapshotPath);

    // Update index with new path
    index.documentPath = newPath;
    index.documentName = getDocumentName(newPath);
    index.status = "active";
    index.deletedAt = null;

    // Save updated index (note: still at old hash location)
    await writeTextFile(indexPath, JSON.stringify(index, null, 2));

    console.log("[History] Restored document to:", newPath);
    return snapshotContent;
  } catch (error) {
    console.error("[History] Failed to restore document:", error);
    return null;
  }
}

/**
 * Permanently delete history for a document
 */
export async function deleteHistory(pathHash: string): Promise<void> {
  try {
    const baseDir = await getHistoryBaseDir();
    const historyDir = await join(baseDir, pathHash);

    if (await exists(historyDir)) {
      await remove(historyDir, { recursive: true });
      console.log("[History] Deleted history for:", pathHash);
    }
  } catch (error) {
    console.error("[History] Failed to delete history:", error);
  }
}

/**
 * Clear all history
 */
export async function clearAllHistory(): Promise<void> {
  try {
    const baseDir = await getHistoryBaseDir();
    if (await exists(baseDir)) {
      await remove(baseDir, { recursive: true });
      console.log("[History] Cleared all history");
    }
  } catch (error) {
    console.error("[History] Failed to clear all history:", error);
  }
}
