/**
 * Search Store
 *
 * Purpose: State for the Find & Replace bar — query, options (case/word/regex),
 *   match count, and current match index.
 *
 * Pipeline: User types in FindBar → setQuery() → editor adapter plugin reads
 *   query via subscription → highlights matches → setMatches(count, index) →
 *   FindBar displays "N of M".
 *
 * Key decisions:
 *   - Replace actions dispatch CustomEvents ("search:replace-current",
 *     "search:replace-all") rather than calling editor APIs directly, because
 *     both CodeMirror and ProseMirror adapters need to handle replacement in
 *     their own way. The store stays editor-agnostic.
 *   - currentIndex resets to -1 on query/option change to avoid stale positions.
 *
 * @coordinates-with FindBar component — UI for search controls
 * @coordinates-with searchHighlight plugin — ProseMirror adapter
 * @coordinates-with cmSearch extension — CodeMirror adapter
 * @module stores/searchStore
 */

import { create } from "zustand";

interface SearchState {
  isOpen: boolean;
  query: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  matchCount: number;
  currentIndex: number;
}

interface SearchActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  setReplaceText: (text: string) => void;
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
  toggleRegex: () => void;
  setMatches: (count: number, currentIndex: number) => void;
  findNext: () => void;
  findPrevious: () => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
}

const initialState: SearchState = {
  isOpen: false,
  query: "",
  replaceText: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  matchCount: 0,
  currentIndex: -1,
};

export const useSearchStore = create<SearchState & SearchActions>((set, get) => ({
  ...initialState,

  open: () => set({ isOpen: true }),

  close: () => set({ isOpen: false }),

  toggle: () => set((state) => ({ isOpen: !state.isOpen })),

  setQuery: (query) => set({ query, currentIndex: -1 }),

  setReplaceText: (replaceText) => set({ replaceText }),

  toggleCaseSensitive: () =>
    set((state) => ({ caseSensitive: !state.caseSensitive, currentIndex: -1 })),

  toggleWholeWord: () =>
    set((state) => ({ wholeWord: !state.wholeWord, currentIndex: -1 })),

  toggleRegex: () =>
    set((state) => ({ useRegex: !state.useRegex, currentIndex: -1 })),

  setMatches: (matchCount, currentIndex) => set({ matchCount, currentIndex }),

  findNext: () => {
    const { matchCount, currentIndex } = get();
    if (matchCount === 0) return;
    const next = currentIndex + 1 >= matchCount ? 0 : currentIndex + 1;
    set({ currentIndex: next });
  },

  findPrevious: () => {
    const { matchCount, currentIndex } = get();
    if (matchCount === 0) return;
    const prev = currentIndex - 1 < 0 ? matchCount - 1 : currentIndex - 1;
    set({ currentIndex: prev });
  },

  replaceCurrent: () => {
    // Dispatch event for editor adapters (both CodeMirror and ProseMirror)
    window.dispatchEvent(new CustomEvent("search:replace-current"));
  },

  replaceAll: () => {
    // Dispatch event for editor adapters (both CodeMirror and ProseMirror)
    window.dispatchEvent(new CustomEvent("search:replace-all"));
  },
}));
