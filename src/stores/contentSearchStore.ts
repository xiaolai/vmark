/**
 * Content Search Store
 *
 * Purpose: State for the workspace-wide "Find in Files" feature — query, search
 *   options, results, and selection index for keyboard navigation.
 *
 * Pipeline: User types in ContentSearch overlay → debounced setQuery() →
 *   search() calls invoke("search_workspace_content") → results displayed
 *   in the overlay → user selects → file opens at matching line.
 *
 * Key decisions:
 *   - Request ID pattern (searchRequestId) prevents stale async responses from
 *     overwriting newer results when the user types fast.
 *   - selectedIndex is a flat index across all matches (file headers are not
 *     selectable), enabling simple arrow-key navigation.
 *   - Regex validation happens in Rust, not frontend — grep-regex syntax differs
 *     from JS RegExp. Invalid regex errors are displayed inline.
 *   - Extensions list comes from MARKDOWN_EXTENSIONS in dropPaths.ts so the
 *     source of truth for "what counts as markdown" stays in one place.
 *
 * @coordinates-with ContentSearch.tsx — overlay UI
 * @coordinates-with content_search.rs — Rust backend command
 * @coordinates-with contentSearchNavigation.ts — pending scroll after file open
 * @module stores/contentSearchStore
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { MARKDOWN_EXTENSIONS } from "@/utils/dropPaths";

/** A single match range within a line (character indices into lineContent). */
export interface MatchRange {
  start: number;
  end: number;
}

/** A matching line within a file. */
export interface LineMatch {
  lineNumber: number;
  lineContent: string;
  matchRanges: MatchRange[];
}

/** All matches within a single file. */
export interface FileSearchResult {
  path: string;
  relativePath: string;
  matches: LineMatch[];
}

interface ContentSearchState {
  isOpen: boolean;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  markdownOnly: boolean;
  results: FileSearchResult[];
  /** Flat index across all match rows (file headers excluded). */
  selectedIndex: number;
  isSearching: boolean;
  error: string | null;
  /** Total match count across all files. */
  totalMatches: number;
  /** Total files with matches. */
  totalFiles: number;
}

interface ContentSearchActions {
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  setCaseSensitive: (value: boolean) => void;
  setWholeWord: (value: boolean) => void;
  setUseRegex: (value: boolean) => void;
  setMarkdownOnly: (value: boolean) => void;
  search: (rootPath: string, excludeFolders: string[]) => Promise<void>;
  selectNext: () => void;
  selectPrev: () => void;
  clearResults: () => void;
}

/** Monotonic request counter to ignore stale search responses. */
let searchRequestId = 0;

/** Count total flat match rows for keyboard navigation. */
function countFlatMatches(results: FileSearchResult[]): number {
  return results.reduce((sum, file) => sum + file.matches.length, 0);
}

const initialState: ContentSearchState = {
  isOpen: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  markdownOnly: true,
  results: [],
  selectedIndex: 0,
  isSearching: false,
  error: null,
  totalMatches: 0,
  totalFiles: 0,
};

/** Manages "Find in Files" state — workspace content search query, options, results, and keyboard selection. Use selectors, not destructuring. */
export const useContentSearchStore = create<ContentSearchState & ContentSearchActions>(
  (set, get) => ({
    ...initialState,

    open: () =>
      set({
        isOpen: true,
        selectedIndex: 0,
        error: null,
      }),

    close: () => {
      ++searchRequestId; // invalidate in-flight searches
      set({ isOpen: false, isSearching: false });
    },

    setQuery: (query) => set({ query, selectedIndex: 0, error: null }),

    setCaseSensitive: (value) => set({ caseSensitive: value }),

    setWholeWord: (value) => set({ wholeWord: value }),

    setUseRegex: (value) => set({ useRegex: value }),

    setMarkdownOnly: (value) => set({ markdownOnly: value }),

    search: async (rootPath, excludeFolders) => {
      const { query, caseSensitive, wholeWord, useRegex, markdownOnly } =
        get();

      if (query.trim().length < 3) {
        set({ results: [], totalMatches: 0, totalFiles: 0, error: null });
        return;
      }

      const requestId = ++searchRequestId;
      set({ isSearching: true, error: null });

      try {
        const extensions = markdownOnly
          ? (MARKDOWN_EXTENSIONS as readonly string[]).map((ext) => ext)
          : [];

        const results = await invoke<FileSearchResult[]>(
          "search_workspace_content",
          {
            rootPath,
            query,
            caseSensitive,
            wholeWord,
            useRegex,
            markdownOnly,
            extensions,
            excludeFolders,
          }
        );

        // Ignore stale response
        if (requestId !== searchRequestId) return;

        const totalMatches = results.reduce(
          (sum, f) =>
            sum + f.matches.reduce((s, m) => s + m.matchRanges.length, 0),
          0
        );

        set({
          results,
          totalMatches,
          totalFiles: results.length,
          isSearching: false,
          selectedIndex: 0,
          error: null,
        });
      } catch (error) {
        // Ignore stale error
        if (requestId !== searchRequestId) return;

        set({
          results: [],
          totalMatches: 0,
          totalFiles: 0,
          isSearching: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    selectNext: () => {
      const { results, selectedIndex } = get();
      const total = countFlatMatches(results);
      if (total === 0) return;
      set({ selectedIndex: (selectedIndex + 1) % total });
    },

    selectPrev: () => {
      const { results, selectedIndex } = get();
      const total = countFlatMatches(results);
      if (total === 0) return;
      set({ selectedIndex: (selectedIndex - 1 + total) % total });
    },

    clearResults: () => {
      ++searchRequestId; // invalidate in-flight searches
      set({
        results: [],
        totalMatches: 0,
        totalFiles: 0,
        selectedIndex: 0,
        error: null,
        isSearching: false,
      });
    },
  })
);
