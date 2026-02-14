/**
 * Pending Saves Tracker (Content-Based)
 *
 * Purpose: Tracks the exact content being written to files to reliably
 * distinguish our own saves from external modifications in file watcher events.
 *
 * This is a content-based approach that eliminates timing race conditions:
 * - Stores the exact content we're about to write
 * - On file watcher event, compare disk content to pending content
 * - If they match, it's our save (regardless of timing)
 *
 * Usage:
 * 1. Call registerPendingSave(path, content) BEFORE writeTextFile()
 * 2. Call clearPendingSave(path) AFTER markSaved()
 * 3. Use matchesPendingSave(path, diskContent) to check if disk matches what we wrote
 *
 * Key decisions:
 *   - Content comparison (not timestamp-based) because filesystem timestamps
 *     have platform-dependent resolution and can race with watcher events
 *   - Map keyed by normalized path for cross-platform consistency
 *
 * @coordinates-with saveToPath.ts — registers pending save before write
 * @coordinates-with reloadFromDisk.ts — checks matchesPendingSave to skip self-triggered reloads
 * @coordinates-with fsEventFilter.ts — uses hasPendingSave for quick watcher event filtering
 * @module utils/pendingSaves
 */

import { normalizePath } from "@/utils/paths";

/** Map of normalized path -> content we're writing */
const pendingSaves = new Map<string, string>();

/**
 * Register that we're about to save specific content to a file.
 * Call this BEFORE writeTextFile().
 *
 * @param path - File path being saved to
 * @param content - The exact content being written
 */
export function registerPendingSave(path: string, content: string): void {
  const normalized = normalizePath(path);
  pendingSaves.set(normalized, content);
}

/**
 * Clear a pending save.
 * Call this AFTER markSaved() completes.
 */
export function clearPendingSave(path: string): void {
  const normalized = normalizePath(path);
  pendingSaves.delete(normalized);
}

/**
 * Check if the given disk content matches what we're currently writing.
 * This is the core of content-based verification - if the disk content
 * matches our pending save, it's our own save, not an external change.
 *
 * @param path - File path to check
 * @param diskContent - Content read from disk
 * @returns true if disk content matches our pending save
 */
export function matchesPendingSave(path: string, diskContent: string): boolean {
  const normalized = normalizePath(path);
  const pendingContent = pendingSaves.get(normalized);

  if (pendingContent === undefined) {
    return false;
  }

  return diskContent === pendingContent;
}

/**
 * Check if a path has a pending save registered.
 * Useful for quick checks before reading the file.
 */
export function hasPendingSave(path: string): boolean {
  const normalized = normalizePath(path);
  return pendingSaves.has(normalized);
}

/**
 * Clear all pending saves (for testing).
 */
export function clearAllPendingSaves(): void {
  pendingSaves.clear();
}
