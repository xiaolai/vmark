/**
 * Prompt history store — persisted freeform AI prompt history.
 *
 * Stores the last MAX_ENTRIES unique prompts with MRU ordering. Used by
 * the genie picker freeform-mode autocomplete.
 *
 * Multi-window reconciliation: every window shares one localStorage key but
 * has its own store instance, so each write re-reads the persisted list and
 * merges before persisting (see persistedListMerge.ts).
 *
 * @module stores/aiStore/promptHistory
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createSafeStorage } from "@/services/persistence/safeStorage";
import { mergeMruList, readPersistedList } from "@/stores/persistedListMerge";

const MAX_ENTRIES = 100;
const STORAGE_KEY = "vmark-prompt-history";

interface PromptHistoryState {
  entries: string[];
}

interface PromptHistoryActions {
  addEntry(prompt: string): void;
  clearHistory(): void;
  getFilteredEntries(prefix: string): string[];
}

/** Manages persisted freeform AI prompt history (max 100) with MRU ordering and deduplication. Use selectors, not destructuring. */
export const usePromptHistoryStore = create<
  PromptHistoryState & PromptHistoryActions
>()(
  persist(
    (set, get) => ({
      entries: [],

      addEntry: (prompt) => {
        const trimmed = prompt.trim();
        if (!trimmed) return;

        set((state) => {
          const mine = [trimmed, ...state.entries.filter((e) => e !== trimmed)];
          // Merge with whatever another window persisted since this one
          // hydrated. Entries carry no timestamps, so other-window entries
          // sort after this window's MRU order (approximate recency), and a
          // clearHistory in another window may be resurrected by a later
          // merge — acceptable for history, no tombstones.
          return {
            entries: mergeMruList(
              mine,
              readPersistedList<string>(STORAGE_KEY, "entries"),
              MAX_ENTRIES,
            ),
          };
        });
      },

      clearHistory: () => set({ entries: [] }),

      getFilteredEntries: (prefix) => {
        const { entries } = get();
        if (!prefix) return entries;
        const lower = prefix.toLowerCase();
        return entries.filter((e) => e.toLowerCase().includes(lower));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state) => ({
        entries: state.entries,
      }),
    }
  )
);
