/**
 * Content Search (Find in Files)
 *
 * Purpose: Spotlight-style overlay for searching workspace file contents.
 * User types a query, results stream in grouped by file, keyboard or click
 * selects a match which opens the file at that line with FindBar pre-filled.
 *
 * Follows the QuickOpen pattern: portal to document.body, click-outside
 * via useDismissOnOutsideOrEscape (deferred attach), IME guard,
 * data-index scroll tracking. Search scheduling lives in
 * useContentSearchScheduler; the option buttons and result list are split
 * into ContentSearchToggles / ContentSearchResults.
 *
 * @coordinates-with contentSearchStore.ts — search state
 * @coordinates-with contentSearchNavigation.ts — pending scroll on file open
 * @coordinates-with useFileOpen.ts — opens file in tab
 * @coordinates-with useContentSearchScheduler.ts — debounced search dispatch
 * @coordinates-with ContentSearchToggles.tsx — option buttons + status text
 * @coordinates-with ContentSearchResults.tsx — grouped file/match list
 * @module components/ContentSearch/ContentSearch
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  useUIStore,
  type FileSearchResult,
  type LineMatch,
} from "@/stores/uiStore";
import { openFileInNewTabCore } from "@/hooks/useFileOpen";
import { setPendingContentSearchNav } from "@/hooks/contentSearchNavigation";
import { useActiveWorkspaceScope } from "@/hooks/useActiveWorkspaceScope";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import {
  handleSpotlightTabTrap,
  useSpotlightFocusManagement,
} from "@/components/spotlight/spotlightDialog";
import { contentSearchLog, contentSearchWarn } from "@/utils/debug";
import { buildFlatIndex } from "./contentSearchUtils";
import {
  useContentSearchScheduler,
  MIN_QUERY_LENGTH,
} from "./useContentSearchScheduler";
import { ContentSearchToggles } from "./ContentSearchToggles";
import { ContentSearchResults } from "./ContentSearchResults";
import "./content-search.css";

interface ContentSearchProps {
  windowLabel: string;
}

/** Spotlight-style overlay for searching workspace file contents (Find in Files). */
export function ContentSearch({ windowLabel }: ContentSearchProps) {
  const { t } = useTranslation("editor");
  const isOpen = useUIStore((s) => s.contentSearch.isOpen);
  const query = useUIStore((s) => s.contentSearch.query);
  const results = useUIStore((s) => s.contentSearch.results);
  const selectedIndex = useUIStore((s) => s.contentSearch.selectedIndex);
  const isSearching = useUIStore((s) => s.contentSearch.isSearching);
  const error = useUIStore((s) => s.contentSearch.error);
  const totalMatches = useUIStore((s) => s.contentSearch.totalMatches);
  const totalFiles = useUIStore((s) => s.contentSearch.totalFiles);
  const caseSensitive = useUIStore((s) => s.contentSearch.caseSensitive);
  const wholeWord = useUIStore((s) => s.contentSearch.wholeWord);
  const useRegex = useUIStore((s) => s.contentSearch.useRegex);
  const markdownOnly = useUIStore((s) => s.contentSearch.markdownOnly);

  const { rootPath, isWorkspaceMode, excludeFolders } =
    useActiveWorkspaceScope(windowLabel);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const ime = useImeComposition();

  const flatIndex = useMemo(() => buildFlatIndex(results), [results]);

  // Reset and focus on open (shared with QuickOpen).
  useSpotlightFocusManagement(isOpen, inputRef, previousFocusRef);

  // Debounced search scheduling (min-length gate + fresh exclusions).
  useContentSearchScheduler({
    isOpen,
    query,
    rootPath,
    excludeFolders,
    caseSensitive,
    wholeWord,
    useRegex,
    markdownOnly,
  });

  const handleClose = useCallback(() => {
    useUIStore.getState().contentSearchClose();
  }, []);

  const handleSelectMatch = useCallback(
    async (file: FileSearchResult, match: LineMatch) => {
      handleClose();

      contentSearchLog("Opening", file.relativePath, "at line", match.lineNumber);
      try {
        // Register the pending scroll/FindBar target using the tab id the
        // open resolves to, BEFORE the editor mounts. The onTabCreated
        // callback fires synchronously inside openFileInNewTabCore (after
        // createTab, before the content read), so the pending nav is always
        // in place when the new editor mounts and consumes it — closing the
        // race where a new tab could activate before the nav was set.
        await openFileInNewTabCore(windowLabel, file.path, {
          onTabCreated: (tabId) => {
            setPendingContentSearchNav(tabId, match.lineNumber, query);
          },
        });
      } catch (err) {
        contentSearchWarn("Failed to open search result:", err);
      }
    },
    [windowLabel, handleClose, query]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;

      if (e.key === "Tab") {
        // Focus trap: cycle within the dialog (aria-modal semantics).
        handleSpotlightTabTrap(e, containerRef.current);
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        useUIStore.getState().contentSearchSelectNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        useUIStore.getState().contentSearchSelectPrev();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (flatIndex.length > 0 && selectedIndex < flatIndex.length) {
          const { fileIndex, matchIndex } = flatIndex[selectedIndex];
          const file = results[fileIndex];
          const match = file.matches[matchIndex];
          handleSelectMatch(file, match);
        }
      }
    },
    [handleClose, flatIndex, selectedIndex, results, handleSelectMatch, ime]
  );

  // Click outside to close. Escape is handled by the component's own
  // onKeyDown (preventDefault + Tab focus trap), so only the outside-click
  // half is delegated here. Deferred attach prevents the opening click from
  // immediately dismissing; bubble phase matches the original code.
  useDismissOnOutsideOrEscape(isOpen, containerRef, handleClose, {
    deferActivation: true,
    escape: false,
    capture: false,
  });

  // Scroll selected match into view
  useEffect(() => {
    if (!listRef.current || selectedIndex < 0) return;
    const item = listRef.current.querySelector(
      `[data-match-index="${selectedIndex}"]`
    );
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Status message
  let statusText = "";
  let statusError = false;
  if (error) {
    statusText = error;
    statusError = true;
  } else if (isSearching) {
    statusText = t("contentSearch.searching", "Searching...");
  } else if (query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH) {
    statusText = t("contentSearch.minChars", "Type at least 3 characters");
  } else if (results.length > 0) {
    statusText = t("contentSearch.resultCount", "{{matches}} matches in {{files}} files", {
      matches: totalMatches,
      files: totalFiles,
    });
  }

  return createPortal(
    <div className="content-search-backdrop">
      <div
        ref={containerRef}
        className="content-search"
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={t("contentSearch.ariaLabel", "Find in Files")}
      >
        <div className="content-search-header">
          <div className="content-search-input-row">
            <input
              ref={inputRef}
              className="content-search-input"
              type="text"
              placeholder={
                isWorkspaceMode
                  ? t("contentSearch.placeholder", "Search in files...")
                  : t("contentSearch.noWorkspace", "Open a workspace first")
              }
              // WI-2.4 (a11y) — explicit accessible name. Placeholder text
              // is not a reliable label for screen readers and changes based
              // on workspace state. Key defined in editor locale namespace.
              aria-label={t("contentSearch.label")}
              disabled={!isWorkspaceMode}
              value={query}
              onChange={(e) =>
                useUIStore.getState().contentSearchSetQuery(e.target.value)
              }
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
            />
          </div>
          <ContentSearchToggles
            caseSensitive={caseSensitive}
            wholeWord={wholeWord}
            useRegex={useRegex}
            markdownOnly={markdownOnly}
            statusText={statusText}
            statusError={statusError}
          />
        </div>

        <div
          className="content-search-results"
          ref={listRef}
          role="listbox"
        >
          {results.length === 0 &&
            !isSearching &&
            query.trim().length >= MIN_QUERY_LENGTH &&
            !error && (
              <div className="content-search-empty">
                {t("contentSearch.noResults", "No results found")}
              </div>
            )}
          <ContentSearchResults
            results={results}
            selectedIndex={selectedIndex}
            onSelectMatch={handleSelectMatch}
          />
        </div>

        <div className="content-search-footer">
          <span className="content-search-footer-hint">
            <kbd className="content-search-kbd">&uarr;&darr;</kbd>{" "}
            {t("contentSearch.hintNavigate", "navigate")}{" "}
            <kbd className="content-search-kbd">Enter</kbd>{" "}
            {t("contentSearch.hintOpen", "open")}{" "}
            <kbd className="content-search-kbd">Esc</kbd>{" "}
            {t("contentSearch.hintClose", "close")}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
