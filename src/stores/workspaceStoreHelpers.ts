/**
 * Native-menu IPC for the recent-files / recent-workspaces stores.
 *
 * Purpose: the fire-and-forget bridge from Zustand state to the macOS menus and
 * dock, extracted from workspaceStore.ts so the store file holds state only.
 *
 * Key decision: each menu command is a SERIALIZED channel. The store actions are
 * synchronous but the IPC is not, so a rapid add → remove → clear burst used to
 * race: three unsequenced `invoke`s can complete in any order and leave the
 * native menu showing a list the store no longer holds. Queuing per channel means
 * the last enqueued list is the last one to reach Rust. An idle channel still
 * issues its command synchronously — the sync-on-mount hooks depend on that.
 *
 * @coordinates-with workspaceStore.ts — sole caller
 * @module stores/workspaceStoreHelpers
 */

import { invoke } from "@tauri-apps/api/core";
import { recentWarn } from "@/utils/debug";

/** In-flight tail per channel. Absent = idle. */
const chains = new Map<string, Promise<void>>();

/**
 * Run `task` after every task already queued on `channel`. Returns the queued
 * promise (tests await it; production ignores it). A rejected task does not
 * poison the channel. Exported for testing.
 */
export function queueNativeMenuSync(channel: string, task: () => Promise<void>): Promise<void> {
  const previous = chains.get(channel);
  const next: Promise<void> = previous
    ? previous.then(task, task) // drain regardless of how the predecessor settled
    : task(); // idle → issue the IPC now, not a microtask later
  chains.set(channel, next);
  // Release the channel once it drains, so the next call takes the fast path.
  void next.catch(() => {}).then(() => {
    if (chains.get(channel) === next) chains.delete(channel);
  });
  return next;
}

/** Push the recent-files list to the native menu. Failures are logged, never thrown. */
export function syncRecentFilesMenu(paths: string[]): void {
  void queueNativeMenuSync("recent-files", async () => {
    try {
      await invoke("update_recent_files", { files: paths });
    } catch (error) {
      recentWarn("Failed to update recent files native menu:", error);
    }
  });
}

/** Push the recent-workspaces list to the native menu. Failures are logged, never thrown. */
export function syncRecentWorkspacesMenu(paths: string[]): void {
  void queueNativeMenuSync("recent-workspaces", async () => {
    try {
      await invoke("update_recent_workspaces", { workspaces: paths });
    } catch (error) {
      recentWarn("Failed to update recent workspaces native menu:", error);
    }
  });
}

/** Register a path in the macOS dock's "Recent" list. Silent elsewhere — the
 *  command only exists on macOS, so a rejection here is expected, not a fault. */
export function registerDockRecent(path: string): void {
  void (async () => {
    try {
      await invoke("register_dock_recent", { path });
    } catch {
      /* not macOS (or no dock) — nothing to report */
    }
  })();
}
