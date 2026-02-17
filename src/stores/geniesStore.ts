/**
 * Genies Store
 *
 * Purpose: Manages loaded AI genie definitions — prompt templates read from
 *   disk at startup, with persisted recent/favorite lists for quick access.
 *
 * Pipeline: App startup → loadGenies() → Rust list_genies + read_genie for
 *   each entry → genies[] populated → GeniePicker shows searchable list →
 *   user picks genie → addRecent() → AI invocation via aiProviderStore.
 *
 * Key decisions:
 *   - Genie definitions are NOT persisted — only names of recents/favorites
 *     are stored. Genies are re-read from disk on each app launch to pick up
 *     user edits to genie files.
 *   - Stale recent/favorite names are pruned after loading to remove references
 *     to deleted genie files.
 *   - Race guard (_loadId) prevents stale results when loadGenies() is called
 *     rapidly (e.g., folder change during initial load).
 *
 * @coordinates-with aiProviderStore.ts — active provider executes the selected genie
 * @coordinates-with genies.rs — Rust backend that lists/reads genie markdown files
 * @module stores/geniesStore
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type { GenieDefinition, GenieMetadata, GenieScope } from "@/types/aiGenies";
import { geniesWarn, geniesLog } from "@/utils/debug";

// ============================================================================
// Types
// ============================================================================

interface GenieEntry {
  name: string;
  path: string;
  source: string;
  category: string | null;
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

// Race guard counter for loadGenies — prevents stale results from overwriting
let _loadId = 0;

// ============================================================================
// Store
// ============================================================================

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

          // Stale check
          if (thisLoadId !== _loadId) return;

          const genies: GenieDefinition[] = [];
          for (const entry of entries) {
            try {
              const content: GenieContent = await invoke("read_genie", {
                path: entry.path,
              });
              genies.push({
                metadata: {
                  ...content.metadata,
                  // Fall back to folder-based category from listing
                  category: content.metadata.category ?? entry.category ?? undefined,
                },
                template: content.template,
                filePath: entry.path,
                source: "global",
              });
            } catch (e) {
              geniesWarn(`Failed to read genie ${entry.path}:`, e);
            }
          }

          // Stale check after reading all genies
          if (thisLoadId !== _loadId) return;

          // Prune stale recents/favorites
          const genieNames = new Set(genies.map((g) => g.metadata.name));
          const { recentGenieNames, favoriteGenieNames } = get();
          const prunedRecents = recentGenieNames.filter((n) => genieNames.has(n));
          const prunedFavorites = favoriteGenieNames.filter((n) => genieNames.has(n));

          set({
            genies,
            loading: false,
            recentGenieNames: prunedRecents,
            favoriteGenieNames: prunedFavorites,
          });
        } catch (e) {
          geniesLog("Failed to load genies:", e);
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
          const filtered = state.recentGenieNames.filter((n) => n !== name);
          return {
            recentGenieNames: [name, ...filtered].slice(0, MAX_RECENTS),
          };
        });
      },

      toggleFavorite: (name) => {
        set((state) => {
          const isFav = state.favoriteGenieNames.includes(name);
          return {
            favoriteGenieNames: isFav
              ? state.favoriteGenieNames.filter((n) => n !== name)
              : [...state.favoriteGenieNames, name],
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
      name: "vmark-genies",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        recentGenieNames: state.recentGenieNames,
        favoriteGenieNames: state.favoriteGenieNames,
      }),
    }
  )
);
