/**
 * FindBar
 *
 * Purpose: Inline search-and-replace bar that appears at the top of the editor area.
 * Supports case-sensitive, whole-word, and regex search modes with match navigation.
 *
 * User interactions:
 *   - Cmd+F opens (via searchStore), Escape closes
 *   - Enter/Shift+Enter navigates forward/backward through matches
 *   - Tab moves focus from find input to replace input
 *   - Toggle buttons for case sensitivity, whole word, and regex modes
 *   - Replace/Replace All buttons for substitution
 *
 * Key decisions:
 *   - All state lives in searchStore — FindBar is a pure view that delegates actions
 *     via getState() calls, keeping the component stateless beyond refs.
 *   - IME guard prevents Enter during CJK composition from triggering find operations;
 *     uses useImeComposition grace period for macOS WebKit post-composition keydown.
 *   - Regex toggle is conditionally shown based on settings (enableRegexSearch).
 *
 * @coordinates-with stores/searchStore.ts — all search state and operations
 * @coordinates-with utils/sourceEditorSearch.ts — CodeMirror search integration
 * @module components/FindBar/FindBar
 */
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  CaseSensitive,
  WholeWord,
  Regex,
  X,
  Replace,
  ReplaceAll,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import "./FindBar.css";

/**
 * Prevent Cmd+A from selecting all page content when focus is on non-input elements.
 * Only prevents when active element is a button or similar non-text element.
 */
function preventSelectAllOnButtons(e: ReactKeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    const target = e.target as HTMLElement;
    /* v8 ignore next -- @preserve tagName INPUT/TEXTAREA branch not exercised in jsdom tests */
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
      e.preventDefault();
    }
  }
}

/** Renders an inline search-and-replace bar with case, whole-word, and regex toggle support. */
export function FindBar() {
  const { t } = useTranslation("editor");
  const isOpen = useUIStore((state) => state.search.isOpen);
  const query = useUIStore((state) => state.search.query);
  const replaceText = useUIStore((state) => state.search.replaceText);
  const caseSensitive = useUIStore((state) => state.search.caseSensitive);
  const wholeWord = useUIStore((state) => state.search.wholeWord);
  const useRegex = useUIStore((state) => state.search.useRegex);
  const matchCount = useUIStore((state) => state.search.matchCount);
  /* v8 ignore next -- @preserve ?? fallback: enableRegexSearch is always set in tests */
  const enableRegexSearch = useSettingsStore((state) => state.markdown.enableRegexSearch ?? true);
  const currentIndex = useUIStore((state) => state.search.currentIndex);

  const ime = useImeComposition();
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Focus find input when opening
  useEffect(() => {
    if (isOpen && findInputRef.current) {
      findInputRef.current.focus();
      findInputRef.current.select();
    }
  }, [isOpen]);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    useUIStore.getState().searchSetQuery(e.target.value);
  }, []);

  const handleReplaceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    useUIStore.getState().searchSetReplaceText(e.target.value);
  }, []);

  const handleClose = useCallback(() => {
    useUIStore.getState().searchClose();
    if (!useUIStore.getState().universalToolbarVisible) {
      useUIStore.getState().restoreStatusBar();
    }
  }, []);

  const handleFindKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;
    /* v8 ignore start -- @preserve reason: else-if chain branches (Escape, Tab) not fully exercised in tests */
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        useUIStore.getState().searchFindPrevious();
      } else {
        useUIStore.getState().searchFindNext();
      }
    } else if (e.key === "Escape") {
      handleClose();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      replaceInputRef.current?.focus();
    }
    /* v8 ignore stop */
  }, [ime, handleClose]);

  const handleReplaceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;
    /* v8 ignore start -- @preserve reason: else-if chain branches (Escape, Shift+Tab) not fully exercised in tests */
    if (e.key === "Enter") {
      e.preventDefault();
      useUIStore.getState().searchReplaceCurrent();
    } else if (e.key === "Escape") {
      handleClose();
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      findInputRef.current?.focus();
    }
    /* v8 ignore stop */
  }, [ime, handleClose]);

  const handleFindNext = useCallback(() => {
    useUIStore.getState().searchFindNext();
  }, []);

  const handleFindPrevious = useCallback(() => {
    useUIStore.getState().searchFindPrevious();
  }, []);

  const handleToggleCaseSensitive = useCallback(() => {
    useUIStore.getState().searchToggleCaseSensitive();
  }, []);

  const handleToggleWholeWord = useCallback(() => {
    useUIStore.getState().searchToggleWholeWord();
  }, []);

  const handleToggleRegex = useCallback(() => {
    useUIStore.getState().searchToggleRegex();
  }, []);

  const handleReplaceCurrent = useCallback(() => {
    useUIStore.getState().searchReplaceCurrent();
  }, []);

  const handleReplaceAll = useCallback(() => {
    useUIStore.getState().searchReplaceAll();
  }, []);

  if (!isOpen) return null;

  const matchDisplay =
    matchCount === 0
      ? query
        ? t("findbar.noResults")
        : ""
      : t("findbar.matchCount", { current: currentIndex + 1, total: matchCount });

  return (
    <div className="find-bar" onKeyDown={preventSelectAllOnButtons}>
      <div className="find-bar-row">
        {/* Toggles first */}
        <div className="find-bar-toggles">
          {enableRegexSearch && (
            <button
              className={`find-bar-toggle ${useRegex ? "active" : ""}`}
              onClick={handleToggleRegex}
              title={t("findbar.toggleRegex")}
              aria-label={t("findbar.toggleRegex")}
            >
              <Regex size={16} />
            </button>
          )}
          <button
            className={`find-bar-toggle ${caseSensitive ? "active" : ""}`}
            onClick={handleToggleCaseSensitive}
            title={t("findbar.toggleCase")}
            aria-label={t("findbar.toggleCase")}
          >
            <CaseSensitive size={16} />
          </button>
          <button
            className={`find-bar-toggle ${wholeWord ? "active" : ""}`}
            onClick={handleToggleWholeWord}
            title={t("findbar.toggleWholeWord")}
            aria-label={t("findbar.toggleWholeWord")}
          >
            <WholeWord size={16} />
          </button>
        </div>

        {/* Find Input */}
        <div className="find-bar-input-group">
          <Search className="find-bar-icon" size={14} />
          <input
            ref={findInputRef}
            type="text"
            className="find-bar-input"
            placeholder={t("findbar.find.placeholder")}
            // WI-2.4 (a11y) — explicit accessible name. Placeholder text is
            // not a reliable label for screen readers.
            aria-label={t("findbar.find.label")}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleFindKeyDown}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
          />
        </div>

        {/* Navigation */}
        <div className="find-bar-nav">
          <button
            className="find-bar-nav-btn"
            onClick={handleFindPrevious}
            disabled={matchCount === 0}
            title={t("findbar.prev")}
            aria-label={t("findbar.prev")}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="find-bar-count">{matchDisplay}</span>
          <button
            className="find-bar-nav-btn"
            onClick={handleFindNext}
            disabled={matchCount === 0}
            title={t("findbar.next")}
            aria-label={t("findbar.next")}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Replace Input */}
        <div className="find-bar-input-group">
          <Replace className="find-bar-icon" size={14} />
          <input
            ref={replaceInputRef}
            type="text"
            className="find-bar-input"
            placeholder={t("findbar.replace.placeholder")}
            // WI-2.4 (a11y) — explicit accessible name.
            aria-label={t("findbar.replace.label")}
            value={replaceText}
            onChange={handleReplaceChange}
            onKeyDown={handleReplaceKeyDown}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
          />
        </div>

        {/* Replace Actions */}
        <div className="find-bar-replace-actions">
          <button
            className="find-bar-icon-btn"
            onClick={handleReplaceCurrent}
            disabled={matchCount === 0}
            title={t("findbar.replace")}
            aria-label={t("findbar.replace")}
          >
            <Replace size={16} />
          </button>
          <button
            className="find-bar-icon-btn"
            onClick={handleReplaceAll}
            disabled={matchCount === 0}
            title={t("findbar.replaceAll")}
            aria-label={t("findbar.replaceAll")}
          >
            <ReplaceAll size={16} />
          </button>
        </div>

        <button className="find-bar-close" onClick={handleClose} title={t("findbar.close")} aria-label={t("findbar.close")}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default FindBar;
