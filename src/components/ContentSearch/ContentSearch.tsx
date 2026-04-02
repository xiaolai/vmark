/**
 * Content Search (Find in Files)
 *
 * Purpose: Spotlight-style overlay for searching workspace file contents.
 * User types a query, results stream in grouped by file, keyboard or click
 * selects a match which opens the file at that line with FindBar pre-filled.
 *
 * Follows the QuickOpen pattern: portal to document.body, click-outside
 * via setTimeout(0), IME guard, data-index scroll tracking.
 *
 * @coordinates-with contentSearchStore.ts — search state
 * @coordinates-with contentSearchNavigation.ts — pending scroll on file open
 * @coordinates-with useFileOpen.ts — opens file in tab
 * @module components/ContentSearch/ContentSearch
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  useContentSearchStore,
  type FileSearchResult,
  type LineMatch,
} from "@/stores/contentSearchStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { openFileInNewTabCore } from "@/hooks/useFileOpen";
import { setPendingContentSearchNav } from "@/hooks/contentSearchNavigation";
import { useTabStore } from "@/stores/tabStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import "./content-search.css";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

const EMPTY_FOLDERS: string[] = [];

function FileIcon() {
  return (
    <svg className="content-search-file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M4 1h5l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
      <path d="M9 1v4h4" />
    </svg>
  );
}

/** Render line content with match ranges highlighted. */
function renderHighlightedLine(
  text: string,
  ranges: { start: number; end: number }[]
): React.ReactNode {
  if (ranges.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    if (start > lastEnd) {
      parts.push(text.slice(lastEnd, start));
    }
    parts.push(
      <span key={i} className="content-search-highlight">
        {text.slice(start, end)}
      </span>
    );
    lastEnd = end;
  }

  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return parts;
}

/** Build a flat list of { fileIndex, matchIndex } for keyboard navigation. */
function buildFlatIndex(
  results: FileSearchResult[]
): { fileIndex: number; matchIndex: number }[] {
  const flat: { fileIndex: number; matchIndex: number }[] = [];
  for (let fi = 0; fi < results.length; fi++) {
    for (let mi = 0; mi < results[fi].matches.length; mi++) {
      flat.push({ fileIndex: fi, matchIndex: mi });
    }
  }
  return flat;
}

interface ContentSearchProps {
  windowLabel: string;
}

/** Spotlight-style overlay for searching workspace file contents (Find in Files). */
export function ContentSearch({ windowLabel }: ContentSearchProps) {
  const { t } = useTranslation("editor");
  const isOpen = useContentSearchStore((s) => s.isOpen);
  const query = useContentSearchStore((s) => s.query);
  const results = useContentSearchStore((s) => s.results);
  const selectedIndex = useContentSearchStore((s) => s.selectedIndex);
  const isSearching = useContentSearchStore((s) => s.isSearching);
  const error = useContentSearchStore((s) => s.error);
  const totalMatches = useContentSearchStore((s) => s.totalMatches);
  const totalFiles = useContentSearchStore((s) => s.totalFiles);
  const caseSensitive = useContentSearchStore((s) => s.caseSensitive);
  const wholeWord = useContentSearchStore((s) => s.wholeWord);
  const useRegex = useContentSearchStore((s) => s.useRegex);
  const markdownOnly = useContentSearchStore((s) => s.markdownOnly);

  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const isWorkspaceMode = useWorkspaceStore((s) => s.isWorkspaceMode);
  const excludeFolders = useWorkspaceStore(
    (s) => s.config?.excludeFolders ?? EMPTY_FOLDERS
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ime = useImeComposition();

  const flatIndex = useMemo(() => buildFlatIndex(results), [results]);

  // Reset and focus on open
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (previousFocusRef.current) {
      const el = previousFocusRef.current as HTMLElement;
      if (typeof el.focus === "function") el.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  // Debounced search on query/options change
  useEffect(() => {
    if (!isOpen || !rootPath) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < MIN_QUERY_LENGTH) {
      useContentSearchStore.getState().clearResults();
      return;
    }

    debounceRef.current = setTimeout(() => {
      useContentSearchStore.getState().search(rootPath, excludeFolders);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, query, caseSensitive, wholeWord, useRegex, markdownOnly, rootPath]);

  const handleClose = useCallback(() => {
    useContentSearchStore.getState().close();
  }, []);

  const handleSelectMatch = useCallback(
    async (file: FileSearchResult, match: LineMatch) => {
      handleClose();

      // Determine the tab ID — either existing tab or new
      const { tabs } = useTabStore.getState();
      const windowTabs = tabs[windowLabel] ?? [];
      const existingTab = windowTabs.find((tab) => tab.filePath === file.path);
      const tabId = existingTab?.id ?? null;

      // Set pending nav before opening the file
      // If the file is already open, the tab ID is known; otherwise
      // openFileInNewTabCore will create a new one and the editor will
      // consume the pending nav on mount.
      if (tabId) {
        setPendingContentSearchNav(tabId, match.lineNumber, query);
      }

      await openFileInNewTabCore(windowLabel, file.path);

      // If it was a new tab, set pending nav using the now-active tab ID
      if (!tabId) {
        const newActiveId = useTabStore.getState().activeTabId[windowLabel];
        if (newActiveId) {
          setPendingContentSearchNav(
            newActiveId,
            match.lineNumber,
            query
          );
        }
      }
    },
    [windowLabel, handleClose, query]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;

      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        useContentSearchStore.getState().selectNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        useContentSearchStore.getState().selectPrev();
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

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, handleClose]);

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

  // Build rendered match list with flat index
  let flatIdx = 0;
  const renderedResults: React.ReactNode[] = [];

  for (let fi = 0; fi < results.length; fi++) {
    const file = results[fi];
    renderedResults.push(
      <div key={`file-${fi}`} className="content-search-file">
        <FileIcon />
        <span>{file.relativePath}</span>
        <span className="content-search-file-count">
          {file.matches.length}
        </span>
      </div>
    );

    for (let mi = 0; mi < file.matches.length; mi++) {
      const match = file.matches[mi];
      const currentFlatIdx = flatIdx++;
      const isSelected = currentFlatIdx === selectedIndex;

      renderedResults.push(
        <div
          key={`match-${fi}-${mi}`}
          className={`content-search-match${isSelected ? " content-search-match--selected" : ""}`}
          data-match-index={currentFlatIdx}
          onClick={() => handleSelectMatch(file, match)}
          onMouseEnter={() =>
            useContentSearchStore.setState({ selectedIndex: currentFlatIdx })
          }
        >
          <span className="content-search-line-num">{match.lineNumber}</span>
          <span className="content-search-line-text">
            {renderHighlightedLine(match.lineContent, match.matchRanges)}
          </span>
        </div>
      );
    }
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
              disabled={!isWorkspaceMode}
              value={query}
              onChange={(e) =>
                useContentSearchStore.getState().setQuery(e.target.value)
              }
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
            />
          </div>
          <div className="content-search-toggles">
            <button
              className={`content-search-toggle${caseSensitive ? " content-search-toggle--active" : ""}`}
              onClick={() =>
                useContentSearchStore
                  .getState()
                  .setCaseSensitive(!caseSensitive)
              }
              aria-pressed={caseSensitive}
              aria-label={t("contentSearch.caseSensitive", "Case Sensitive")}
              title={t("contentSearch.caseSensitive", "Case Sensitive")}
            >
              Aa
            </button>
            <button
              className={`content-search-toggle${wholeWord ? " content-search-toggle--active" : ""}`}
              onClick={() =>
                useContentSearchStore.getState().setWholeWord(!wholeWord)
              }
              aria-pressed={wholeWord}
              aria-label={t("contentSearch.wholeWord", "Whole Word")}
              title={t("contentSearch.wholeWord", "Whole Word")}
            >
              ab
            </button>
            <button
              className={`content-search-toggle${useRegex ? " content-search-toggle--active" : ""}`}
              onClick={() =>
                useContentSearchStore.getState().setUseRegex(!useRegex)
              }
              aria-pressed={useRegex}
              aria-label={t("contentSearch.regex", "Regular Expression")}
              title={t("contentSearch.regex", "Regular Expression")}
            >
              .*
            </button>
            <button
              className={`content-search-toggle${markdownOnly ? " content-search-toggle--active" : ""}`}
              onClick={() =>
                useContentSearchStore.getState().setMarkdownOnly(!markdownOnly)
              }
              aria-pressed={markdownOnly}
              aria-label={t("contentSearch.markdownOnly", "Markdown Files Only")}
              title={t("contentSearch.markdownOnly", "Markdown Files Only")}
            >
              .md
            </button>
            {statusText && (
              <span
                className={`content-search-status${statusError ? " content-search-status--error" : ""}`}
              >
                {statusText}
              </span>
            )}
          </div>
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
          {renderedResults}
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
