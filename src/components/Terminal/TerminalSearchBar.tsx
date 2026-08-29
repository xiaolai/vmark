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
 *   - Aa / ab / .* toggles for case-sensitive, whole-word, regex search
 *
 * Key decisions:
 *   - Auto-focuses the input on mount so the user can start typing immediately.
 *   - Clears SearchAddon decorations on close to avoid stale highlights
 *     persisting in the terminal after the search bar is dismissed.
 *   - Incremental search: each character typed triggers findNext immediately,
 *     providing real-time feedback without needing to press Enter.
 *   - IME guard: during CJK composition, onChange skips findNext to avoid
 *     searching partial pinyin; compositionEnd triggers the search.
 *   - The result summary is driven by `onDidChangeResults`, not by counting
 *     locally: the addon is the only thing that knows the buffer. Its
 *     `resultIndex === -1` (too many matches to track a position) is rendered
 *     as a bare count — see terminalSearchOptions.describeSearchResult.
 *   - Toggle state is local (Q5): it resets when the bar closes, matching the
 *     editor's FindBar. The bar is keyed by session in TerminalPanel, so a
 *     session switch remounts it and resets the toggles too.
 *
 * @coordinates-with TerminalPanel.tsx — toggles visibility via searchVisible state
 * @coordinates-with useTerminalSessions.ts — provides getActiveSearchAddon callback
 * @coordinates-with terminalSearchOptions.ts — pure option/result helpers
 * @module components/Terminal/TerminalSearchBar
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown, X, CaseSensitive, WholeWord, Regex } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SearchAddon } from "@xterm/addon-search";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import {
  DEFAULT_SEARCH_TOGGLES,
  toSearchOptions,
  describeSearchResult,
  isUsableSearchQuery,
  type TerminalSearchToggles,
  type SearchResultState,
} from "./terminalSearchOptions";
import "./TerminalSearchBar.css";

interface TerminalSearchBarProps {
  getSearchAddon: () => SearchAddon | null;
  onClose: () => void;
}

/** The three modifier buttons, in render order. */
const TOGGLE_BUTTONS: Array<{
  field: keyof TerminalSearchToggles;
  labelKey: string;
  Icon: typeof CaseSensitive;
}> = [
  { field: "caseSensitive", labelKey: "terminal.search.matchCase", Icon: CaseSensitive },
  { field: "wholeWord", labelKey: "terminal.search.wholeWord", Icon: WholeWord },
  { field: "regex", labelKey: "terminal.search.regex", Icon: Regex },
];

/** Renders an inline search bar for finding text in terminal output with IME-aware input. */
export function TerminalSearchBar({ getSearchAddon, onClose }: TerminalSearchBarProps) {
  const { t } = useTranslation("statusbar");
  const [query, setQuery] = useState("");
  const [toggles, setToggles] = useState<TerminalSearchToggles>({
    ...DEFAULT_SEARCH_TOGGLES,
  });
  const [result, setResult] = useState<SearchResultState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { composingRef, onCompositionStart, onCompositionEnd: onCompositionEndBase, isComposing } = useImeComposition();
  const compositionSearchedRef = useRef<string | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Subscribe to the addon's result events. Re-subscribing on every keystroke
  // would leak listeners, so this depends only on the addon getter — the bar
  // is remounted (and the listener disposed) when the session changes.
  useEffect(() => {
    const addon = getSearchAddon();
    if (!addon) return;
    // `onDidChangeResults` arrived in the xterm-6 addon line; an older/stub
    // addon degrades to "no count" rather than crashing the panel — but it
    // still PAINTS decorations, so cleanup is registered either way.
    const sub = addon.onDidChangeResults?.((state) => setResult(state));
    return () => {
      sub?.dispose?.();
      // Closing the bar with Cmd+F unmounts it without going through
      // handleClose, so without this the highlights would stay painted on the
      // terminal with nothing left to clear them.
      addon.clearDecorations();
    };
  }, [getSearchAddon]);

  /**
   * Run a search, or degrade to the no-match state when the query cannot be
   * handed to the addon (empty, or a half-typed regex). Never throws into the
   * caller — an incremental search fires on every keystroke.
   */
  const runSearch = useCallback(
    (
      value: string,
      opts: TerminalSearchToggles,
      direction: "next" | "previous" = "next",
    ) => {
      const addon = getSearchAddon();
      if (!addon) return;
      if (!value) {
        addon.clearDecorations();
        setResult(null);
        return;
      }
      if (!isUsableSearchQuery(value, opts)) {
        // A malformed regex matches nothing, by definition.
        addon.clearDecorations();
        setResult({ resultIndex: -1, resultCount: 0 });
        return;
      }
      const searchOptions = toSearchOptions(opts);
      if (direction === "previous") addon.findPrevious(value, searchOptions);
      else addon.findNext(value, searchOptions);
    },
    [getSearchAddon],
  );

  const findNext = useCallback(() => {
    if (query) runSearch(query, toggles, "next");
  }, [runSearch, query, toggles]);

  const findPrevious = useCallback(() => {
    if (query) runSearch(query, toggles, "previous");
  }, [runSearch, query, toggles]);

  const handleClose = useCallback(() => {
    const addon = getSearchAddon();
    if (addon) addon.clearDecorations();
    onClose();
  }, [getSearchAddon, onClose]);

  const toggleOption = useCallback(
    (field: keyof TerminalSearchToggles) => {
      // Computed HERE, not inside the setState updater: React StrictMode
      // invokes updaters twice in development, which would run the search
      // twice and advance the active match by two.
      const next = { ...toggles, [field]: !toggles[field] };
      setToggles(next);
      // Re-run immediately so the highlight matches the new mode without a
      // second keystroke.
      runSearch(query, next, "next");
    },
    [runSearch, query, toggles],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      // Skip live search during IME composition
      if (composingRef.current) return;
      // Skip if compositionEnd already searched this exact value (avoid double search)
      /* v8 ignore next -- @preserve IME double-search guard: requires real IME composition sequence */
      if (compositionSearchedRef.current === value) {
        compositionSearchedRef.current = null;
        return;
      }
      runSearch(value, toggles, "next");
    },
    [runSearch, toggles, composingRef],
  );

  const handleCompositionEnd = useCallback(() => {
    onCompositionEndBase();
    // Trigger search with committed text after composition ends
    /* v8 ignore next -- @preserve ?? fallback: inputRef.current is always set when compositionEnd fires */
    const currentQuery = inputRef.current?.value ?? "";
    // Record that we searched this value so handleChange can skip its duplicate call
    compositionSearchedRef.current = currentQuery;
    runSearch(currentQuery, toggles, "next");
  }, [onCompositionEndBase, runSearch, toggles]);

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

  const display = describeSearchResult(result, query);
  const resultText =
    display.kind === "position"
      ? t("terminal.search.results", { index: display.index, count: display.count })
      : display.kind === "countOnly"
        ? t("terminal.search.manyResults", { count: display.count })
        : display.kind === "noMatch"
          ? t("terminal.search.noResults")
          : "";

  return (
    <div className="terminal-search-bar">
      <input
        ref={inputRef}
        className={
          "vm-input vm-input--bare terminal-search-input" +
          (display.kind === "noMatch" ? " terminal-search-input--no-match" : "")
        }
        type="text"
        placeholder={t("terminal.search.placeholder")}
        // WI-2.4 (a11y) — explicit accessible name.
        aria-label={t("terminal.search.label")}
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
      {/* Announced politely so a screen-reader user hears the count change
          without the typing being interrupted (WI-3.1). */}
      <span className="terminal-search-results" aria-live="polite">
        {resultText}
      </span>
      {TOGGLE_BUTTONS.map(({ field, labelKey, Icon }) => (
        <button
          key={field}
          // Active styling is keyed off `aria-pressed` below rather than a
          // modifier class: one source of truth for the state, and no second
          // hand-rolled button class (see `pnpm lint:bespoke-buttons`).
          className="vm-icon-btn vm-icon-btn--sm"
          onClick={() => toggleOption(field)}
          title={t(labelKey)}
          aria-label={t(labelKey)}
          aria-pressed={toggles[field]}
        >
          <Icon size={14} />
        </button>
      ))}
      <button
        className="vm-icon-btn vm-icon-btn--sm"
        onClick={findPrevious}
        title={t("terminal.search.previous")}
        aria-label={t("terminal.search.previous")}
        disabled={!query}
      >
        <ChevronUp size={14} />
      </button>
      <button
        className="vm-icon-btn vm-icon-btn--sm"
        onClick={findNext}
        title={t("terminal.search.next")}
        aria-label={t("terminal.search.next")}
        disabled={!query}
      >
        <ChevronDown size={14} />
      </button>
      <button className="vm-icon-btn vm-icon-btn--sm" onClick={handleClose} title={t("terminal.search.close")} aria-label={t("terminal.search.close")}>
        <X size={14} />
      </button>
    </div>
  );
}
