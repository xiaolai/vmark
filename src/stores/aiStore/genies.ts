/**
 * Genies store — loaded AI genie definitions with persisted recent/favorite lists.
 *
 * `vmark-genies` localStorage key holds recent & favorite name lists only;
 * the genie definitions themselves are re-loaded from disk via `list_genies`
 * on each app start to pick up file changes.
 *
 * Multi-window reconciliation: every window shares that key but has its own
 * store instance, so addRecent/toggleFavorite re-read the persisted lists and
 * merge before persisting (see persistedListMerge.ts). Because persist
 * serializes on EVERY set(), unrelated sets (loading flags, genie loads)
 * would still push a stale snapshot over another window's write — the
 * storage is wrapped in createFieldChangeGatedStorage so a physical write
 * only happens when the preference lists actually changed in this window.
 * An unfavorite in one window may be resurrected by a later merge in
 * another window that still holds the name — acceptable, no tombstones.
 *
 * @module stores/aiStore/genies
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { createSafeStorage } from "@/services/persistence/safeStorage";
import {
  createFieldChangeGatedStorage,
  mergeMruList,
  readPersistedList,
} from "@/stores/persistedListMerge";
import { geniesWarn, geniesLog } from "@/utils/debug";
import type { GenieDefinition, GenieMetadata, GenieScope } from "@/types/aiGenies";

interface GenieEntry {
  name: string;
  path: string;
  source: string;
  category: string | null;
  /** WI-7.1: discriminator for picker dispatch. */
  kind?: "markdown" | "workflow";
}

interface GenieContent {
  metadata: GenieMetadata;
  template: string;
}

interface GeniesState {
  genies: GenieDefinition[];
  loading: boolean;
  recentGenieNames: string[];
  favoriteGenieNames: string[];
}

interface GeniesActions {
  loadGenies(): Promise<void>;
  searchGenies(query: string, scope?: GenieScope | null): GenieDefinition[];
  getGroupedByCategory(): Map<string, GenieDefinition[]>;
  addRecent(name: string): void;
  toggleFavorite(name: string): void;
  isFavorite(name: string): boolean;
  getRecent(): GenieDefinition[];
}

const MAX_RECENTS = 10;
const STORAGE_KEY = "vmark-genies";

// Race guard counter for loadGenies — prevents stale results from overwriting
let _loadId = 0;

/** Manages loaded AI genie definitions with persisted recent/favorite lists. Use selectors, not destructuring. */
export const useGeniesStore = create<GeniesState & GeniesActions>()(
  persist(
    (set, get) => ({
      genies: [],
      loading: false,
      recentGenieNames: [],
      favoriteGenieNames: [],

      loadGenies: async () => {
        const thisLoadId = ++_loadId;
        set({ loading: true });
        try {
          const entries: GenieEntry[] = await invoke("list_genies");

          if (thisLoadId !== _loadId) return;

          const genies: GenieDefinition[] = [];
          for (const entry of entries) {
            try {
              const content: GenieContent = await invoke("read_genie", {
                path: entry.path,
              });
              // The category falls back file → directory → none, and "none" is
              // the ABSENCE of a category rather than a stated empty one, so
              // an uncategorised genie carries no key at all.
              const { category: fileCategory, ...metadataRest } = content.metadata;
              const category = fileCategory ?? entry.category ?? undefined;
              genies.push({
                metadata:
                  category !== undefined ? { ...metadataRest, category } : metadataRest,
                template: content.template,
                filePath: entry.path,
                source: "global",
                kind: entry.kind ?? "markdown",
              });
            } catch (e) {
              geniesWarn(`Failed to read genie ${entry.path}:`, e);
            }
          }

          if (thisLoadId !== _loadId) return;

          // Prune stale recents/favorites. Merge with the persisted lists
          // FIRST: this set() legitimately changes the guarded fields, so the
          // gated storage will write — an unmerged prune would erase entries
          // another window persisted since this one hydrated. Names absent
          // from the fresh genie list are pruned from both sources alike.
          const genieNames = new Set(genies.map((g) => g.metadata.name));
          const { recentGenieNames, favoriteGenieNames } = get();
          // Merge UNCAPPED, filter, then cap: capping first would let stale
          // names occupy slots and push a valid cross-window entry off the
          // list before the filter could save it.
          const prunedRecents = mergeMruList(
            recentGenieNames,
            readPersistedList<string>(STORAGE_KEY, "recentGenieNames"),
          )
            .filter((n) => genieNames.has(n))
            .slice(0, MAX_RECENTS);
          const prunedFavorites = mergeMruList(
            favoriteGenieNames,
            readPersistedList<string>(STORAGE_KEY, "favoriteGenieNames"),
          ).filter((n) => genieNames.has(n));

          set({
            genies,
            loading: false,
            recentGenieNames: prunedRecents,
            favoriteGenieNames: prunedFavorites,
          });
        } catch (e) {
          geniesLog("Failed to load genies:", e);
          /* v8 ignore next -- @preserve false branch: stale load error, newer load already set loading=false */
          if (thisLoadId === _loadId) {
            set({ loading: false });
          }
        }
      },

      searchGenies: (query, scope) => {
        const { genies } = get();
        const lower = query.toLowerCase();
        return genies.filter((g) => {
          if (scope && g.metadata.scope !== scope) return false;
          if (!lower) return true;
          return (
            g.metadata.name.toLowerCase().includes(lower) ||
            g.metadata.description.toLowerCase().includes(lower) ||
            (g.metadata.category?.toLowerCase().includes(lower) ?? false)
          );
        });
      },

      getGroupedByCategory: () => {
        const { genies } = get();
        const grouped = new Map<string, GenieDefinition[]>();
        for (const g of genies) {
          const cat = g.metadata.category ?? "Uncategorized";
          const list = grouped.get(cat) ?? [];
          list.push(g);
          grouped.set(cat, list);
        }
        return grouped;
      },

      addRecent: (name) => {
        set((state) => {
          const mine = [name, ...state.recentGenieNames.filter((n) => n !== name)];
          // Merge with whatever another window persisted since this one hydrated.
          return {
            recentGenieNames: mergeMruList(
              mine,
              readPersistedList<string>(STORAGE_KEY, "recentGenieNames"),
              MAX_RECENTS,
            ),
          };
        });
      },

      toggleFavorite: (name) => {
        set((state) => {
          const theirs = readPersistedList<string>(STORAGE_KEY, "favoriteGenieNames");
          const isFav = state.favoriteGenieNames.includes(name);
          // Merge first so this write doesn't erase another window's
          // additions; on removal the filter then wins over the merge.
          return {
            favoriteGenieNames: isFav
              ? mergeMruList(state.favoriteGenieNames, theirs).filter((n) => n !== name)
              : mergeMruList([...state.favoriteGenieNames, name], theirs),
          };
        });
      },

      isFavorite: (name) => {
        return get().favoriteGenieNames.includes(name);
      },

      getRecent: () => {
        const { genies, recentGenieNames } = get();
        return recentGenieNames
          .map((name) => genies.find((g) => g.metadata.name === name))
          .filter((g): g is GenieDefinition => g !== undefined);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() =>
        createFieldChangeGatedStorage(createSafeStorage(), [
          "recentGenieNames",
          "favoriteGenieNames",
        ]),
      ),
      partialize: (state) => ({
        recentGenieNames: state.recentGenieNames,
        favoriteGenieNames: state.favoriteGenieNames,
      }),
    }
  )
);
