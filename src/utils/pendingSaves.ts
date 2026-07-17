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
 *    — returns a token for safe clearing
 * 2. Call clearPendingSave(path, token) AFTER markSaved()
 *    — only clears if the token matches (prevents overlapping saves
 *      from clearing each other's registrations)
 * 3. Use matchesPendingSave(path, diskContent) to check if disk matches what we wrote
 *
 * Key decisions:
 *   - Content comparison (not timestamp-based) because filesystem timestamps
 *     have platform-dependent resolution and can race with watcher events
 *   - Map keyed by normalized path for cross-platform consistency
 *   - Token-based clearing prevents overlapping saves to the same path
 *     from prematurely clearing a newer registration
 *
 * @coordinates-with saveToPath.ts — registers pending save before write
 * @coordinates-with reloadFromDisk.ts — checks matchesPendingSave to skip self-triggered reloads
 * @coordinates-with services/workspaceEvents/normalizeFsEvents — hasPendingSave flags self-write echoes
 * @module utils/pendingSaves
 */

import { normalizePath } from "@/utils/paths";

interface PendingEntry {
  content: string;
  token: number;
}

/** Map of normalized path -> pending save entry */
const pendingSaves = new Map<string, PendingEntry>();

/** Monotonically increasing token counter */
let nextToken = 1;

/**
 * Register that we're about to save specific content to a file.
 * Call this BEFORE writeTextFile().
 *
 * @param path - File path being saved to
 * @param content - The exact content being written
 * @returns A token to pass to clearPendingSave for safe clearing
 */
export function registerPendingSave(path: string, content: string): number {
  const normalized = normalizePath(path);
  const token = nextToken++;
  pendingSaves.set(normalized, { content, token });
  return token;
}

/**
 * Clear a pending save, but only if the token matches the current registration.
 * This prevents overlapping saves from clearing each other's entries.
 * Call this AFTER markSaved() completes.
 *
 * @param path - File path to clear
 * @param token - Token returned by registerPendingSave. If omitted, clears unconditionally.
 */
export function clearPendingSave(path: string, token?: number): void {
  const normalized = normalizePath(path);
  if (token !== undefined) {
    const entry = pendingSaves.get(normalized);
    if (entry && entry.token !== token) return; // Newer save registered — don't clear
  }
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
  const entry = pendingSaves.get(normalized);

  if (!entry) {
    return false;
  }

  return diskContent === entry.content;
}

/**
 * Check if a path has a pending save registered.
 * Useful for quick checks before reading the file.
 */
export function hasPendingSave(path: string): boolean {
  const normalized = normalizePath(path);
  return pendingSaves.has(normalized);
}

/** Test helper: clear all pending saves. */
export function _clearAllPendingSaves(): void {
  pendingSaves.clear();
}

