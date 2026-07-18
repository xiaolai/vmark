/**
 * Recents stores — recently opened files and workspaces.
 *
 * Purpose: persisted MRU lists (max 10 each) behind the native "Open Recent"
 * menus and the Welcome/QuickOpen surfaces. Split out of workspaceStore.ts
 * (which had absorbed them in T09 as formerly recentFilesStore.ts /
 * recentWorkspacesStore.ts); workspaceStore.ts re-exports everything here, so
 * consumers keep importing from "@/stores/workspaceStore".
 *
 * Both stores are instantiations of createRecentsStore.ts — one shared
 * machine for persistence, cross-window merge, removal, clear, and
 * native-menu sync; only the storage key, state/action names, and the
 * menu/dock callbacks differ.
 *
 * Multi-window reconciliation: every window shares ONE localStorage key per
 * list (and ONE app-global native menu) but has its own store instance, so a
 * blind write from window A would erase what window B persisted since A
 * hydrated. Each write therefore re-reads the persisted list and merges by
 * path before persisting and syncing the menu (see persistedListMerge.ts).
 * A removal in one window may be resurrected by another window's later
 * merge — acceptable for recents, no tombstones. clearAll stays a deliberate
 * blind wipe.
 *
 * @coordinates-with createRecentsStore.ts — the shared store factory
 * @coordinates-with workspaceStoreHelpers.ts — serialized native-menu/dock IPC
 * @module stores/recentsStore
 */

import {
  registerDockRecent,
  syncRecentFilesMenu,
  syncRecentWorkspacesMenu,
} from "@/stores/workspaceStoreHelpers";
import { createRecentsStore, type RecentEntry } from "@/stores/createRecentsStore";

export type RecentFile = RecentEntry;
export type RecentWorkspace = RecentEntry;

/** Manages recently opened files (max 10) with persistence and native menu sync. */
export const useRecentFilesStore = createRecentsStore({
  storageKey: "vmark-recent-files",
  listKey: "files",
  maxKey: "maxFiles",
  addKey: "addFile",
  removeKey: "removeFile",
  cap: 10,
  syncMenu: (paths) => syncRecentFilesMenu(paths),
  onAdd: (path) => registerDockRecent(path),
});

/** Manages recently opened workspaces (max 10) with persistence and native menu sync. */
export const useRecentWorkspacesStore = createRecentsStore({
  storageKey: "vmark-recent-workspaces",
  listKey: "workspaces",
  maxKey: "maxWorkspaces",
  addKey: "addWorkspace",
  removeKey: "removeWorkspace",
  cap: 10,
  syncMenu: (paths) => syncRecentWorkspacesMenu(paths),
});
