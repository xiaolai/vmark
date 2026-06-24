/**
 * useContentSearchScheduler
 *
 * Purpose: Owns the debounced "run the search" scheduling for ContentSearch.
 * Keeps the debounce timer, the minimum-query-length gate, and the
 * exclude-folders freshness handling out of the component body.
 *
 * Behavior preserved from the inline effect:
 *   - Debounced by DEBOUNCE_MS on query/option/root changes.
 *   - Queries shorter than MIN_QUERY_LENGTH clear results instead of running.
 *   - Exclusions are read at execution time (via a ref) so a late exclusion
 *     change doesn't run a search with stale folders, and the search doesn't
 *     re-fire merely because the (unstable) exclusion array identity changed.
 *
 * @coordinates-with ContentSearch.tsx — sole caller
 * @coordinates-with uiStore — contentSearchRun / contentSearchClearResults
 * @module components/ContentSearch/useContentSearchScheduler
 */
import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/uiStore";

/** Debounce window for streaming search-as-you-type. */
export const DEBOUNCE_MS = 300;
/** Minimum query length before a search is dispatched. */
export const MIN_QUERY_LENGTH = 3;

interface SchedulerArgs {
  isOpen: boolean;
  query: string;
  rootPath: string | null;
  excludeFolders: string[];
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  markdownOnly: boolean;
}

export function useContentSearchScheduler({
  isOpen,
  query,
  rootPath,
  excludeFolders,
  caseSensitive,
  wholeWord,
  useRegex,
  markdownOnly,
}: SchedulerArgs): void {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read exclusions at execution time so a change takes effect on the next
  // query/option change without a stale capture and without re-running the
  // search merely because the array identity changed.
  const excludeFoldersRef = useRef(excludeFolders);
  excludeFoldersRef.current = excludeFolders;

  useEffect(() => {
    if (!isOpen || !rootPath) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < MIN_QUERY_LENGTH) {
      useUIStore.getState().contentSearchClearResults();
      return;
    }

    debounceRef.current = setTimeout(() => {
      useUIStore.getState().contentSearchRun(rootPath, excludeFoldersRef.current);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, query, caseSensitive, wholeWord, useRegex, markdownOnly, rootPath]);
}
