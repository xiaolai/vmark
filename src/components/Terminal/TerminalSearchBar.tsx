/**
 * TerminalSearchBar
 *
 * Purpose: Inline search bar for finding text in terminal output.
 * Uses xterm's SearchAddon for incremental highlight-as-you-type search.
 * IME-aware: skips search during composition and guards keyDown with grace period.
 *
 * User interactions:
 *   - Type to search (highlights matches incrementally)
 *   - Enter for next match, Shift+Enter for previous
 *   - Escape to close and clear highlights
 *   - Up/Down chevron buttons for next/previous
 *
 * Key decisions:
 *   - Auto-focuses the input on mount so the user can start typing immediately.
 *   - Clears SearchAddon decorations on close to avoid stale highlights
 *     persisting in the terminal after the search bar is dismissed.
 *   - Incremental search: each character typed triggers findNext immediately,
 *     providing real-time feedback without needing to press Enter.
 *   - IME guard: during CJK composition, onChange skips findNext to avoid
 *     searching partial pinyin; compositionEnd triggers the search.
 *
 * @coordinates-with TerminalPanel.tsx — toggles visibility via searchVisible state
 * @coordinates-with useTerminalSessions.ts — provides getActiveSearchAddon callback
 * @module components/Terminal/TerminalSearchBar
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import type { SearchAddon } from "@xterm/addon-search";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import "./TerminalSearchBar.css";

interface TerminalSearchBarProps {
  getSearchAddon: () => SearchAddon | null;
  onClose: () => void;
}

export function TerminalSearchBar({ getSearchAddon, onClose }: TerminalSearchBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { composingRef, onCompositionStart, onCompositionEnd: onCompositionEndBase, isComposing } = useImeComposition();
  const compositionSearchedRef = useRef<string | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const findNext = useCallback(() => {
    const addon = getSearchAddon();
    if (addon && query) addon.findNext(query);
  }, [getSearchAddon, query]);

  const findPrevious = useCallback(() => {
    const addon = getSearchAddon();
    if (addon && query) addon.findPrevious(query);
  }, [getSearchAddon, query]);

  const handleClose = useCallback(() => {
    const addon = getSearchAddon();
    if (addon) addon.clearDecorations();
    onClose();
  }, [getSearchAddon, onClose]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      // Skip live search during IME composition
      if (composingRef.current) return;
      // Skip if compositionEnd already searched this exact value (avoid double search)
      if (compositionSearchedRef.current === value) {
        compositionSearchedRef.current = null;
        return;
      }
      const addon = getSearchAddon();
      if (addon) {
        if (value) {
          addon.findNext(value);
        } else {
          addon.clearDecorations();
        }
      }
    },
    [getSearchAddon, composingRef],
  );

  const handleCompositionEnd = useCallback(() => {
    onCompositionEndBase();
    // Trigger search with committed text after composition ends
    const addon = getSearchAddon();
    const currentQuery = inputRef.current?.value ?? "";
    // Record that we searched this value so handleChange can skip its duplicate call
    compositionSearchedRef.current = currentQuery;
    if (addon) {
      if (currentQuery) {
        addon.findNext(currentQuery);
      } else {
        addon.clearDecorations();
      }
    }
  }, [onCompositionEndBase, getSearchAddon]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeKeyEvent(e.nativeEvent) || isComposing()) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          findPrevious();
        } else {
          findNext();
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    },
    [findNext, findPrevious, handleClose, isComposing],
  );

  return (
    <div className="terminal-search-bar">
      <input
        ref={inputRef}
        className="terminal-search-input"
        type="text"
        placeholder="Search..."
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
      <button
        className="terminal-search-btn"
        onClick={findPrevious}
        title="Previous (Shift+Enter)"
        disabled={!query}
      >
        <ChevronUp size={14} />
      </button>
      <button
        className="terminal-search-btn"
        onClick={findNext}
        title="Next (Enter)"
        disabled={!query}
      >
        <ChevronDown size={14} />
      </button>
      <button className="terminal-search-btn" onClick={handleClose} title="Close (Escape)">
        <X size={14} />
      </button>
    </div>
  );
}
