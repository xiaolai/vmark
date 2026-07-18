/**
 * createRecentsStore — typed factory for persisted MRU path-list stores.
 *
 * Purpose: the recent-files and recent-workspaces stores are the same
 * machine (persistence, cross-window merge, removal, clear, native-menu
 * sync) differing only in storage key, state/action names, cap, and the
 * menu-sync / dock callbacks. This factory holds that machine once;
 * recentsStore.ts instantiates it twice with the public key names, so
 * both exported store APIs stay exactly as they were.
 *
 * Key decisions:
 *   - State/action names are generic string-literal type parameters so the
 *     resulting store is structurally identical to the hand-written ones
 *     (`files`/`addFile`… vs `workspaces`/`addWorkspace`…). Building an
 *     object from computed keys erases those literal types, so the returned
 *     state object carries one localized `as` cast; the public store type
 *     is fully precise.
 *   - Removal merges the cross-window list UNCAPPED, then filters the
 *     removed path, then caps — merge-cap-filter returned N-1 entries and
 *     dropped the candidate that should slide into the freed slot.
 *   - clearAll stays a deliberate blind wipe (no merge).
 *
 * @coordinates-with recentsStore.ts — the two instantiations
 * @coordinates-with persistedListMerge.ts — read-merge-write helpers
 * @module stores/createRecentsStore
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createSafeStorage } from "@/services/persistence/safeStorage";
import { getFileName } from "@/utils/pathUtils";
import { mergeNewestFirst, readPersistedList } from "@/stores/persistedListMerge";

export interface RecentEntry {
  path: string;
  name: string;
  timestamp: number;
}

export interface RecentsStoreConfig<
  ListKey extends string,
  MaxKey extends string,
  AddKey extends string,
  RemoveKey extends string,
> {
  /** Shared localStorage key (one per list across all windows). */
  storageKey: string;
  /** State field holding the entry list (also the persisted field name). */
  listKey: ListKey;
  /** State field exposing the cap. */
  maxKey: MaxKey;
  addKey: AddKey;
  removeKey: RemoveKey;
  cap: number;
  /** Sync the app-global native menu with the given paths. */
  syncMenu: (paths: string[]) => void;
  /** Optional extra registration on add (e.g. macOS dock recents). */
  onAdd?: (path: string) => void;
}

export type RecentsStoreState<
  ListKey extends string,
  MaxKey extends string,
  AddKey extends string,
  RemoveKey extends string,
> = { [K in ListKey]: RecentEntry[] } & { [K in MaxKey]: number } & {
  [K in AddKey]: (path: string) => void;
} & { [K in RemoveKey]: (path: string) => void } & {
  clearAll: () => void;
  syncToNativeMenu: () => void;
};

const keyOf = (e: RecentEntry): string => e.path;
const timeOf = (e: RecentEntry): number => e.timestamp;

export function createRecentsStore<
  ListKey extends string,
  MaxKey extends string,
  AddKey extends string,
  RemoveKey extends string,
>(config: RecentsStoreConfig<ListKey, MaxKey, AddKey, RemoveKey>) {
  type S = RecentsStoreState<ListKey, MaxKey, AddKey, RemoveKey>;

  /** What another window has persisted to the shared key. */
  const persisted = (): RecentEntry[] =>
    readPersistedList<RecentEntry>(config.storageKey, config.listKey);

  return create<S>()(
    persist(
      (set, get) => {
        const list = (): RecentEntry[] =>
          (get() as Record<ListKey, RecentEntry[]>)[config.listKey];
        const cap = (): number =>
          (get() as Record<MaxKey, number>)[config.maxKey];
        const commit = (next: RecentEntry[]): void => {
          set({ [config.listKey]: next } as unknown as Partial<S> as S);
          config.syncMenu(next.map((e) => e.path));
        };

        const add = (path: string): void => {
          const name = getFileName(path) || path;
          const mine = [
            { path, name, timestamp: Date.now() },
            ...list().filter((e) => e.path !== path),
          ];
          commit(mergeNewestFirst(mine, persisted(), keyOf, timeOf, cap()));
          config.onAdd?.(path);
        };

        const remove = (path: string): void => {
          // Merge first so the removal doesn't erase another window's
          // additions — UNCAPPED, so filtering the removed path lets the
          // next candidate slide into the freed slot; the cap comes last.
          const merged = mergeNewestFirst(
            list(),
            persisted(),
            keyOf,
            timeOf,
            Number.POSITIVE_INFINITY,
          );
          commit(merged.filter((e) => e.path !== path).slice(0, cap()));
        };

        return {
          [config.listKey]: [] as RecentEntry[],
          [config.maxKey]: config.cap,
          [config.addKey]: add,
          [config.removeKey]: remove,
          clearAll: () => commit([]),
          syncToNativeMenu: () => config.syncMenu(list().map((e) => e.path)),
        } as unknown as S;
      },
      {
        name: config.storageKey,
        storage: createJSONStorage(() => createSafeStorage()),
      },
    ),
  );
}
