/**
 * Prompt history store — persisted freeform AI prompt history.
 *
 * Stores the last MAX_ENTRIES unique prompts with MRU ordering. Used by
 * the genie picker freeform-mode autocomplete.
 *
 * @module stores/aiStore/promptHistory
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createSafeStorage } from "@/services/persistence/safeStorage";

const MAX_ENTRIES = 100;

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
          const filtered = state.entries.filter((e) => e !== trimmed);
          return {
            entries: [trimmed, ...filtered].slice(0, MAX_ENTRIES),
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
      name: "vmark-prompt-history",
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state) => ({
        entries: state.entries,
      }),
    }
  )
);
