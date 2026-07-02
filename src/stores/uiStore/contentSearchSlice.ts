/**
 * uiStore `contentSearch` slice — workspace-wide content search initial
 * state and actions.
 *
 * Purpose: initial value and action implementations for the
 * `s.contentSearch` namespace of the UI store. Extracted verbatim from
 * `../uiStore.ts` (pure code motion; behavior unchanged), including the
 * module-level request-ID counter that cancels stale in-flight searches.
 * Type declarations (MatchRange, LineMatch, FileSearchResult, slice and
 * action shapes) live in `./types.ts` (one-directional imports — no
 * cycles).
 *
 * @module stores/uiStore/contentSearchSlice
 */

import { invoke } from "@tauri-apps/api/core";
import { listFormats } from "@/lib/formats/registry";
import { errorMessage } from "@/utils/errorMessage";
import type {
  ContentSearchActions,
  ContentSearchSlice,
  FileSearchResult,
  UIGet,
  UISet,
} from "./types";

export const initialContentSearch: ContentSearchSlice = {
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

let contentSearchRequestId = 0;

function countFlatMatches(results: FileSearchResult[]): number {
  return results.reduce((sum, file) => sum + file.matches.length, 0);
}

export function createContentSearchActions(
  set: UISet,
  get: UIGet,
): ContentSearchActions {
  return {
    contentSearchOpen: () =>
      set((s) => ({
        contentSearch: {
          ...s.contentSearch,
          isOpen: true,
          selectedIndex: 0,
          error: null,
        },
      })),
    contentSearchClose: () => {
      ++contentSearchRequestId;
      set((s) => ({
        contentSearch: { ...s.contentSearch, isOpen: false, isSearching: false },
      }));
    },
    contentSearchSetQuery: (query) =>
      set((s) => ({
        contentSearch: {
          ...s.contentSearch,
          query,
          selectedIndex: 0,
          error: null,
        },
      })),
    contentSearchSetCaseSensitive: (value) =>
      set((s) => ({
        contentSearch: { ...s.contentSearch, caseSensitive: value },
      })),
    contentSearchSetWholeWord: (value) =>
      set((s) => ({
        contentSearch: { ...s.contentSearch, wholeWord: value },
      })),
    contentSearchSetUseRegex: (value) =>
      set((s) => ({
        contentSearch: { ...s.contentSearch, useRegex: value },
      })),
    contentSearchSetMarkdownOnly: (value) =>
      set((s) => ({
        contentSearch: { ...s.contentSearch, markdownOnly: value },
      })),
    contentSearchRun: async (rootPath, excludeFolders) => {
      const { query, caseSensitive, wholeWord, useRegex, markdownOnly } =
        get().contentSearch;

      if (query.trim().length < 3) {
        // Bump the request id so an older in-flight search can't land
        // afterwards and repopulate stale results (audit-fix).
        ++contentSearchRequestId;
        set((s) => ({
          contentSearch: {
            ...s.contentSearch,
            results: [],
            totalMatches: 0,
            totalFiles: 0,
            isSearching: false,
            error: null,
          },
        }));
        return;
      }

      const requestId = ++contentSearchRequestId;
      set((s) => ({
        contentSearch: { ...s.contentSearch, isSearching: true, error: null },
      }));

      try {
        const extensions = markdownOnly
          ? listFormats()
              .filter((f) => f.adapters.contentSearchIndexed === true)
              .flatMap((f) => f.extensions.map((ext) => `.${ext}`))
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
          },
        );

        if (requestId !== contentSearchRequestId) return;

        const totalMatches = results.reduce(
          (sum, f) =>
            sum + f.matches.reduce((ss, m) => ss + m.matchRanges.length, 0),
          0,
        );

        set((s) => ({
          contentSearch: {
            ...s.contentSearch,
            results,
            totalMatches,
            totalFiles: results.length,
            isSearching: false,
            selectedIndex: 0,
            error: null,
          },
        }));
      } catch (error) {
        if (requestId !== contentSearchRequestId) return;
        set((s) => ({
          contentSearch: {
            ...s.contentSearch,
            results: [],
            totalMatches: 0,
            totalFiles: 0,
            isSearching: false,
            error: errorMessage(error),
          },
        }));
      }
    },
    contentSearchSelectNext: () => {
      const { results, selectedIndex } = get().contentSearch;
      const total = countFlatMatches(results);
      if (total === 0) return;
      set((s) => ({
        contentSearch: {
          ...s.contentSearch,
          selectedIndex: (selectedIndex + 1) % total,
        },
      }));
    },
    contentSearchSelectPrev: () => {
      const { results, selectedIndex } = get().contentSearch;
      const total = countFlatMatches(results);
      if (total === 0) return;
      set((s) => ({
        contentSearch: {
          ...s.contentSearch,
          selectedIndex: (selectedIndex - 1 + total) % total,
        },
      }));
    },
    contentSearchClearResults: () => {
      ++contentSearchRequestId;
      set((s) => ({
        contentSearch: {
          ...s.contentSearch,
          results: [],
          totalMatches: 0,
          totalFiles: 0,
          selectedIndex: 0,
          error: null,
          isSearching: false,
        },
      }));
    },
  };
}
