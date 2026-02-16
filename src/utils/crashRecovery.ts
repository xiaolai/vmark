/**
 * Crash Recovery Utilities
 *
 * Core read/write/delete operations for recovery snapshots.
 * Periodically writes dirty document content to {appDataDir}/recovery/
 * so it can be restored after unexpected crashes.
 *
 * @module utils/crashRecovery
 * @coordinates-with useCrashRecoveryWriter, useCrashRecoveryStartup, useCrashRecoveryCleanup
 */

import {
  writeTextFile,
  readTextFile,
  readDir,
  exists,
  mkdir,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { crashRecoveryLog } from "./debug";

export interface RecoverySnapshot {
  version: 1;
  tabId: string;
  windowLabel: string;
  content: string;
  filePath: string | null;
  title: string;
  timestamp: number;
}

const RECOVERY_DIR_NAME = "recovery";
const SNAPSHOT_PREFIX = "snapshot-";
const SNAPSHOT_SUFFIX = ".json";
const TMP_PREFIX = ".tmp-";

// --- Path helpers (shared naming logic) ---

/** Build the final snapshot file path for a tab. */
async function snapshotPath(dir: string, tabId: string): Promise<string> {
  return join(dir, `${SNAPSHOT_PREFIX}${tabId}${SNAPSHOT_SUFFIX}`);
}

/** Build a unique temp file path for atomic writes. */
async function tmpPath(dir: string, tabId: string): Promise<string> {
  return join(dir, `${TMP_PREFIX}${tabId}-${Date.now()}`);
}

/** Check whether a filename matches the snapshot naming convention. */
function isSnapshotFilename(name: string): boolean {
  return name.startsWith(SNAPSHOT_PREFIX) && name.endsWith(SNAPSHOT_SUFFIX);
}

// --- Public API ---

/**
 * Get the recovery directory path.
 */
export async function getRecoveryDir(): Promise<string> {
  const base = await appDataDir();
  return join(base, RECOVERY_DIR_NAME);
}

/**
 * Ensure the recovery directory exists, creating it if needed.
 */
export async function ensureRecoveryDir(): Promise<string> {
  const dir = await getRecoveryDir();
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

/**
 * Write a recovery snapshot atomically (write to tmp, then rename).
 * Returns true on success, false on failure (logged, never throws).
 */
export async function writeRecoverySnapshot(
  snapshot: RecoverySnapshot
): Promise<boolean> {
  try {
    const dir = await ensureRecoveryDir();
    const tmp = await tmpPath(dir, snapshot.tabId);
    const final = await snapshotPath(dir, snapshot.tabId);

    await writeTextFile(tmp, JSON.stringify(snapshot));
    await rename(tmp, final);
    crashRecoveryLog("Wrote snapshot for", snapshot.tabId);
    return true;
  } catch (error) {
    crashRecoveryLog(
      "Failed to write snapshot:",
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Read all valid recovery snapshots from the recovery directory.
 * Skips corrupted files and files missing required fields.
 * Returns empty array if directory doesn't exist.
 */
export async function readRecoverySnapshots(): Promise<RecoverySnapshot[]> {
  try {
    const dir = await getRecoveryDir();
    if (!(await exists(dir))) return [];

    const entries = await readDir(dir);
    const snapshots: RecoverySnapshot[] = [];

    for (const entry of entries) {
      if (!entry.name || !isSnapshotFilename(entry.name)) continue;

      try {
        const filePath = await join(dir, entry.name);
        const content = await readTextFile(filePath);
        const parsed = JSON.parse(content);

        if (isValidSnapshot(parsed)) {
          snapshots.push(parsed);
        }
      } catch {
        crashRecoveryLog("Skipping corrupted snapshot:", entry.name);
      }
    }

    return snapshots;
  } catch (error) {
    crashRecoveryLog(
      "Failed to read snapshots:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

/**
 * Delete the recovery snapshot for a specific tab.
 * Fire-and-forget safe — logs errors, never throws.
 */
export async function deleteRecoverySnapshot(tabId: string): Promise<void> {
  try {
    const dir = await getRecoveryDir();
    const path = await snapshotPath(dir, tabId);

    if (await exists(path)) {
      await remove(path);
      crashRecoveryLog("Deleted snapshot for", tabId);
    }
  } catch (error) {
    crashRecoveryLog(
      "Failed to delete snapshot:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Delete all recovery files (snapshots and tmp files).
 * Called on normal exit.
 */
export async function deleteAllRecoveryFiles(): Promise<void> {
  try {
    const dir = await getRecoveryDir();
    if (!(await exists(dir))) return;

    const entries = await readDir(dir);
    for (const entry of entries) {
      if (!entry.name) continue;
      try {
        const filePath = await join(dir, entry.name);
        await remove(filePath);
      } catch {
        // Best-effort deletion
      }
    }
    crashRecoveryLog("Deleted all recovery files");
  } catch (error) {
    crashRecoveryLog(
      "Failed to delete all recovery files:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Delete recovery files for specific tabs only.
 * Used for per-window cleanup on normal exit.
 */
export async function deleteRecoveryFilesForTabs(
  tabIds: string[]
): Promise<void> {
  for (const tabId of tabIds) {
    await deleteRecoverySnapshot(tabId);
  }
}

/**
 * Delete recovery files older than maxAgeDays.
 * Reads each snapshot to check its timestamp.
 */
export async function deleteStaleRecoveryFiles(
  maxAgeDays = 7
): Promise<void> {
  try {
    const dir = await getRecoveryDir();
    if (!(await exists(dir))) return;

    const entries = await readDir(dir);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    for (const entry of entries) {
      if (!entry.name || !isSnapshotFilename(entry.name)) continue;

      try {
        const filePath = await join(dir, entry.name);
        const content = await readTextFile(filePath);
        const parsed = JSON.parse(content);

        if (
          Number.isFinite(parsed.timestamp) &&
          parsed.timestamp < cutoff
        ) {
          await remove(filePath);
          crashRecoveryLog("Deleted stale snapshot:", entry.name);
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch (error) {
    crashRecoveryLog(
      "Failed to delete stale files:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Validate that a parsed JSON object has the required RecoverySnapshot fields.
 */
function isValidSnapshot(obj: unknown): obj is RecoverySnapshot {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    o.version === 1 &&
    typeof o.tabId === "string" &&
    typeof o.windowLabel === "string" &&
    typeof o.content === "string" &&
    (o.filePath === null || typeof o.filePath === "string") &&
    typeof o.title === "string" &&
    typeof o.timestamp === "number" &&
    Number.isFinite(o.timestamp)
  );
}
