/**
 * uiStore `search` slice — in-document find/replace initial state and
 * actions.
 *
 * Purpose: initial value and action implementations for the `s.search`
 * namespace of the UI store. Extracted verbatim from `../uiStore.ts`
 * (pure code motion; behavior unchanged). Type declarations live in
 * `./types.ts` (one-directional imports — no cycles). The composition
 * root spreads `createSearchActions(set, get)` into the store factory.
 *
 * @module stores/uiStore/searchSlice
 */

import type { SearchActions, SearchSlice, UIGet, UISet } from "./types";

export const initialSearch: SearchSlice = {
  isOpen: false,
  query: "",
  replaceText: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  searchMarkdown: false,
  matchCount: 0,
  currentIndex: -1,
};

export function createSearchActions(set: UISet, get: UIGet): SearchActions {
  return {
    searchOpen: () => set((s) => ({ search: { ...s.search, isOpen: true } })),
    searchClose: () =>
      set((s) => ({ search: { ...s.search, isOpen: false } })),
    searchToggle: () =>
      set((s) => ({ search: { ...s.search, isOpen: !s.search.isOpen } })),
    searchSetQuery: (query) =>
      set((s) => ({ search: { ...s.search, query, currentIndex: -1 } })),
    searchSetReplaceText: (replaceText) =>
      set((s) => ({ search: { ...s.search, replaceText } })),
    searchToggleCaseSensitive: () =>
      set((s) => ({
        search: {
          ...s.search,
          caseSensitive: !s.search.caseSensitive,
          currentIndex: -1,
        },
      })),
    searchToggleWholeWord: () =>
      set((s) => ({
        search: {
          ...s.search,
          wholeWord: !s.search.wholeWord,
          currentIndex: -1,
        },
      })),
    searchToggleRegex: () =>
      set((s) => ({
        search: {
          ...s.search,
          useRegex: !s.search.useRegex,
          currentIndex: -1,
        },
      })),
    searchToggleSearchMarkdown: () =>
      set((s) => ({
        search: {
          ...s.search,
          searchMarkdown: !s.search.searchMarkdown,
          currentIndex: -1,
        },
      })),
    searchSetMatches: (matchCount, currentIndex) =>
      set((s) => {
        // Clamp so stale/invalid caller values can't wedge navigation:
        // count >= 0, index in [-1, count - 1] (-1 = no current match).
        const count = Math.max(0, Math.floor(matchCount));
        const index = Math.min(Math.max(Math.floor(currentIndex), -1), count - 1);
        return { search: { ...s.search, matchCount: count, currentIndex: index } };
      }),
    searchFindNext: () => {
      const { matchCount, currentIndex } = get().search;
      if (matchCount === 0) return;
      const next = currentIndex + 1 >= matchCount ? 0 : currentIndex + 1;
      set((s) => ({ search: { ...s.search, currentIndex: next } }));
    },
    searchFindPrevious: () => {
      const { matchCount, currentIndex } = get().search;
      if (matchCount === 0) return;
      const prev = currentIndex - 1 < 0 ? matchCount - 1 : currentIndex - 1;
      set((s) => ({ search: { ...s.search, currentIndex: prev } }));
    },
    searchReplaceCurrent: () => {
      window.dispatchEvent(new CustomEvent("search:replace-current"));
    },
    searchReplaceAll: () => {
      window.dispatchEvent(new CustomEvent("search:replace-all"));
    },
  };
}
