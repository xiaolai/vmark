/**
 * TerminalSearchBar
 *
 * Purpose: Inline search bar for finding text in terminal output.
 * Uses xterm's SearchAddon for incremental highlight-as-you-type search.
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
 *
 * @coordinates-with TerminalPanel.tsx — toggles visibility via searchVisible state
 * @coordinates-with useTerminalSessions.ts — provides getActiveSearchAddon callback
 * @module components/Terminal/TerminalSearchBar
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import type { SearchAddon } from "@xterm/addon-search";
import "./TerminalSearchBar.css";

interface TerminalSearchBarProps {
  getSearchAddon: () => SearchAddon | null;
  onClose: () => void;
}

export function TerminalSearchBar({ getSearchAddon, onClose }: TerminalSearchBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
      const addon = getSearchAddon();
      if (addon) {
        if (value) {
          addon.findNext(value);
        } else {
          addon.clearDecorations();
        }
      }
    },
    [getSearchAddon],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    [findNext, findPrevious, handleClose],
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
