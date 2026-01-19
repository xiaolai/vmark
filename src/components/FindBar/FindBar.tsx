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
import { useSearchStore } from "@/stores/searchStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import "./FindBar.css";

/**
 * Prevent Cmd+A from selecting all page content when focus is on non-input elements.
 * Only prevents when active element is a button or similar non-text element.
 */
function preventSelectAllOnButtons(e: ReactKeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
      e.preventDefault();
    }
  }
}

export function FindBar() {
  const isOpen = useSearchStore((state) => state.isOpen);
  const query = useSearchStore((state) => state.query);
  const replaceText = useSearchStore((state) => state.replaceText);
  const caseSensitive = useSearchStore((state) => state.caseSensitive);
  const wholeWord = useSearchStore((state) => state.wholeWord);
  const useRegex = useSearchStore((state) => state.useRegex);
  const matchCount = useSearchStore((state) => state.matchCount);
  const enableRegexSearch = useSettingsStore((state) => state.markdown.enableRegexSearch ?? true);
  const currentIndex = useSearchStore((state) => state.currentIndex);

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
    useSearchStore.getState().setQuery(e.target.value);
  }, []);

  const handleReplaceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    useSearchStore.getState().setReplaceText(e.target.value);
  }, []);

  const handleFindKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        useSearchStore.getState().findPrevious();
      } else {
        useSearchStore.getState().findNext();
      }
    } else if (e.key === "Escape") {
      useSearchStore.getState().close();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      replaceInputRef.current?.focus();
    }
  }, []);

  const handleReplaceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      useSearchStore.getState().replaceCurrent();
    } else if (e.key === "Escape") {
      useSearchStore.getState().close();
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      findInputRef.current?.focus();
    }
  }, []);

  const handleClose = useCallback(() => {
    useSearchStore.getState().close();
  }, []);

  const handleFindNext = useCallback(() => {
    useSearchStore.getState().findNext();
  }, []);

  const handleFindPrevious = useCallback(() => {
    useSearchStore.getState().findPrevious();
  }, []);

  const handleToggleCaseSensitive = useCallback(() => {
    useSearchStore.getState().toggleCaseSensitive();
  }, []);

  const handleToggleWholeWord = useCallback(() => {
    useSearchStore.getState().toggleWholeWord();
  }, []);

  const handleToggleRegex = useCallback(() => {
    useSearchStore.getState().toggleRegex();
  }, []);

  const handleReplaceCurrent = useCallback(() => {
    useSearchStore.getState().replaceCurrent();
  }, []);

  const handleReplaceAll = useCallback(() => {
    useSearchStore.getState().replaceAll();
  }, []);

  if (!isOpen) return null;

  const matchDisplay =
    matchCount === 0
      ? query
        ? "No results"
        : ""
      : `${currentIndex + 1} of ${matchCount}`;

  return (
    <div className="find-bar" onKeyDown={preventSelectAllOnButtons}>
      <div className="find-bar-row">
        {/* Toggles first */}
        <div className="find-bar-toggles">
          {enableRegexSearch && (
            <button
              className={`find-bar-toggle ${useRegex ? "active" : ""}`}
              onClick={handleToggleRegex}
              title="Use Regular Expression"
            >
              <Regex size={16} />
            </button>
          )}
          <button
            className={`find-bar-toggle ${caseSensitive ? "active" : ""}`}
            onClick={handleToggleCaseSensitive}
            title="Match Case"
          >
            <CaseSensitive size={16} />
          </button>
          <button
            className={`find-bar-toggle ${wholeWord ? "active" : ""}`}
            onClick={handleToggleWholeWord}
            title="Whole Word"
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
            placeholder="Find..."
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleFindKeyDown}
          />
        </div>

        {/* Navigation */}
        <div className="find-bar-nav">
          <button
            className="find-bar-nav-btn"
            onClick={handleFindPrevious}
            disabled={matchCount === 0}
            title="Previous (Shift+Enter)"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="find-bar-count">{matchDisplay}</span>
          <button
            className="find-bar-nav-btn"
            onClick={handleFindNext}
            disabled={matchCount === 0}
            title="Next (Enter)"
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
            placeholder="Replace..."
            value={replaceText}
            onChange={handleReplaceChange}
            onKeyDown={handleReplaceKeyDown}
          />
        </div>

        {/* Replace Actions */}
        <div className="find-bar-replace-actions">
          <button
            className="find-bar-icon-btn"
            onClick={handleReplaceCurrent}
            disabled={matchCount === 0}
            title="Replace"
            aria-label="Replace"
          >
            <Replace size={16} />
          </button>
          <button
            className="find-bar-icon-btn"
            onClick={handleReplaceAll}
            disabled={matchCount === 0}
            title="Replace All"
            aria-label="Replace All"
          >
            <ReplaceAll size={16} />
          </button>
        </div>

        <button className="find-bar-close" onClick={handleClose} title="Close (Esc)">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default FindBar;
