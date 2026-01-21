/**
 * Hook for managing search functionality in the source editor.
 * Handles search store subscription, find/replace operations, and match counting.
 */
import { useEffect, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import {
  setSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
import { useSearchStore } from "@/stores/searchStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { countMatches } from "@/utils/sourceEditorSearch";

interface SearchState {
  query: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  currentIndex: number;
}

/**
 * Build a CodeMirror SearchQuery from store state.
 * Always includes replace text to avoid stale values during replace operations.
 */
function buildSearchQuery(state: SearchState): SearchQuery {
  return new SearchQuery({
    search: state.query,
    replace: state.replaceText,
    caseSensitive: state.caseSensitive,
    wholeWord: state.wholeWord,
    regexp: state.useRegex,
  });
}

/**
 * Recompute match count from document and update search store.
 * Centralizes the match counting logic to avoid duplication.
 */
function recomputeMatches(
  view: EditorView,
  state: SearchState,
  preserveIndex = false
): void {
  if (!state.query) {
    useSearchStore.getState().setMatches(0, -1);
    return;
  }

  const text = view.state.doc.toString();
  const matchCount = countMatches(
    text,
    state.query,
    state.caseSensitive,
    state.wholeWord,
    state.useRegex
  );

  // Determine new index
  let newIndex: number;
  if (matchCount === 0) {
    newIndex = -1;
  } else if (preserveIndex && state.currentIndex >= 0 && state.currentIndex < matchCount) {
    newIndex = state.currentIndex;
  } else if (state.currentIndex < 0 || state.currentIndex >= matchCount) {
    newIndex = 0;
  } else {
    newIndex = state.currentIndex;
  }

  useSearchStore.getState().setMatches(matchCount, newIndex);
}

/**
 * Subscribe to searchStore and manage CodeMirror search operations.
 */
export function useSourceEditorSearch(
  viewRef: MutableRefObject<EditorView | null>
): void {
  useEffect(() => {
    let isInitialized = false;

    // Initialize search state when view becomes available
    const initSearchState = (): boolean => {
      const view = viewRef.current;
      if (!view) return false;

      const state = useSearchStore.getState();
      if (state.isOpen && state.query) {
        recomputeMatches(view, state);
        const query = buildSearchQuery(state);
        runOrQueueCodeMirrorAction(view, () => {
          view.dispatch({ effects: setSearchQuery.of(query) });
        });
      }
      return true;
    };

    // Try immediate initialization, fall back to polling if view not ready
    if (!initSearchState()) {
      const checkInterval = setInterval(() => {
        if (initSearchState()) {
          isInitialized = true;
          clearInterval(checkInterval);
        }
      }, 50);

      // Safety: clear interval after max wait time
      setTimeout(() => {
        if (!isInitialized) {
          clearInterval(checkInterval);
        }
      }, 500);
    } else {
      isInitialized = true;
    }

    const unsubscribe = useSearchStore.subscribe((state, prevState) => {
      const view = viewRef.current;
      if (!view) return;

      // Update search query when search params change
      if (
        state.query !== prevState.query ||
        state.caseSensitive !== prevState.caseSensitive ||
        state.wholeWord !== prevState.wholeWord ||
        state.useRegex !== prevState.useRegex
      ) {
        if (state.query) {
          const query = buildSearchQuery(state);
          runOrQueueCodeMirrorAction(view, () => {
            view.dispatch({ effects: setSearchQuery.of(query) });
          });
          recomputeMatches(view, state);
        } else {
          // Clear search
          runOrQueueCodeMirrorAction(view, () => {
            view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
          });
          useSearchStore.getState().setMatches(0, -1);
        }
      }

      // Handle find next/previous
      if (state.currentIndex !== prevState.currentIndex && state.currentIndex >= 0) {
        const direction = state.currentIndex > prevState.currentIndex ? 1 : -1;
        if (direction > 0) {
          runOrQueueCodeMirrorAction(view, () => findNext(view));
        } else {
          runOrQueueCodeMirrorAction(view, () => findPrevious(view));
        }
      }

      // Handle replace text changes - always include in query to keep it fresh
      if (state.replaceText !== prevState.replaceText && state.isOpen && state.query) {
        const query = buildSearchQuery(state);
        runOrQueueCodeMirrorAction(view, () => {
          view.dispatch({ effects: setSearchQuery.of(query) });
        });
      }
    });

    // Handle replace actions via custom events
    const handleReplaceCurrent = (): void => {
      const view = viewRef.current;
      if (!view) return;

      runOrQueueCodeMirrorAction(view, () => replaceNext(view));
      // Update match count after replace - double rAF for state to settle
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const state = useSearchStore.getState();
          if (viewRef.current) {
            recomputeMatches(viewRef.current, state, true);
          }
        });
      });
    };

    const handleReplaceAll = (): void => {
      const view = viewRef.current;
      if (!view) return;

      runOrQueueCodeMirrorAction(view, () => replaceAll(view));
      // Update match count after replace all - double rAF for state to settle
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const state = useSearchStore.getState();
          if (viewRef.current) {
            recomputeMatches(viewRef.current, state);
          }
        });
      });
    };

    window.addEventListener("search:replace-current", handleReplaceCurrent);
    window.addEventListener("search:replace-all", handleReplaceAll);

    return () => {
      unsubscribe();
      window.removeEventListener("search:replace-current", handleReplaceCurrent);
      window.removeEventListener("search:replace-all", handleReplaceAll);
    };
  }, [viewRef]);
}
