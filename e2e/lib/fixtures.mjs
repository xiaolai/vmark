/**
 * Disk fixtures for journeys that exercise real file I/O.
 *
 * App-visible fixture files must live under `$HOME/**` because VMark's Tauri
 * fs capability (src-tauri/capabilities/default.json) scopes plugin-fs reads
 * and writes to `$HOME/**` (plus removable volumes). `os.tmpdir()` on macOS
 * is `/var/folders/...`, which is OUTSIDE that scope — the app could never
 * read a fixture placed there. We therefore create a hidden, throwaway
 * directory directly under the home directory via `fs.mkdtemp` (which
 * atomically creates a directory that did not exist — no collision can ever
 * reuse, and later delete, someone else's directory) and remove it
 * (recursively) in teardown, success or failure.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Unique per-call suffix for fixture file names and content markers. */
function uniqueStamp() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a fresh app-readable temp dir under $HOME.
 * Returns { dir, stamp, cleanup } — always call cleanup() in a finally.
 */
export async function makeAppTempDir() {
  const stamp = uniqueStamp();
  const dir = await mkdtemp(join(homedir(), ".vmark-e2e-"));
  return {
    dir,
    stamp,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
