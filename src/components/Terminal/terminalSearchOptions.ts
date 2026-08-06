/**
 * terminalSearchOptions
 *
 * Purpose: The pure half of terminal search (WI-3.1/3.2) — the case /
 * whole-word / regex toggle state, its translation into xterm's
 * `ISearchOptions`, and the interpretation of the addon's result event.
 * Extracted so TerminalSearchBar.tsx stays under the file-size limit and so
 * the tricky result cases are unit-testable without rendering.
 *
 * Key decisions:
 *   - Toggles are component state, not settings (Q5): they reset when the bar
 *     closes, matching the editor's FindBar and avoiding a settings-schema
 *     change for three transient booleans.
 *   - `resultIndex === -1` is a real xterm state, not an error: the addon
 *     stops tracking which match is active once the match count exceeds its
 *     threshold. Rendering that as "0 / N" claims a position that does not
 *     exist, and rendering it as "no matches" contradicts the N. It gets its
 *     own `countOnly` shape.
 *   - An invalid regex is validated HERE rather than caught around the addon
 *     call. Typing a regex is incremental — "[" is a legal keystroke on the
 *     way to "[a-z]" — so it must degrade to the no-match state, not throw
 *     into the search path on every character.
 *
 * @coordinates-with TerminalSearchBar.tsx — sole consumer
 * @module components/Terminal/terminalSearchOptions
 */
import type { ISearchOptions } from "@xterm/addon-search";

/** The three user-facing search modifiers. */
export interface TerminalSearchToggles {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** Every toggle off — the state the bar opens in (Q5). */
export const DEFAULT_SEARCH_TOGGLES: Readonly<TerminalSearchToggles> = Object.freeze({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
});

/**
 * Translate the toggles into xterm's option bag. Every field is sent
 * explicitly (including `false`) so no stale option can linger in the addon
 * between calls.
 */
export function toSearchOptions(toggles: TerminalSearchToggles): ISearchOptions {
  return {
    caseSensitive: toggles.caseSensitive,
    wholeWord: toggles.wholeWord,
    regex: toggles.regex,
  };
}

/**
 * True when the query can safely be handed to the addon. An empty query never
 * can (there is nothing to find); a malformed pattern cannot while regex mode
 * is on.
 */
export function isUsableSearchQuery(
  query: string,
  toggles: TerminalSearchToggles,
): boolean {
  if (!query) return false;
  if (!toggles.regex) return true;
  try {
    new RegExp(query);
    return true;
  } catch {
    return false;
  }
}

/** What the result area should render. */
export type SearchResultDisplay =
  /** Nothing to report — empty query, or no result event yet. */
  | { kind: "none" }
  /** A non-empty query that matched nothing. */
  | { kind: "noMatch" }
  /** The usual case: match `index` (1-based) of `count`. */
  | { kind: "position"; index: number; count: number }
  /** Too many matches for the addon to track a position — count only. */
  | { kind: "countOnly"; count: number };

/** The raw payload of xterm's `onDidChangeResults`. */
export interface SearchResultState {
  resultIndex: number;
  resultCount: number;
}

/**
 * Interpret the addon's last result event for display. `query` is needed
 * because a cleared input leaves the last event behind — reporting its stale
 * count next to an empty box would be wrong.
 */
export function describeSearchResult(
  result: SearchResultState | null,
  query: string,
): SearchResultDisplay {
  if (!query || !result) return { kind: "none" };
  const { resultIndex, resultCount } = result;
  // Zero-trust at the boundary: the addon is third-party, and a NaN count
  // would render as "3 / NaN".
  if (!Number.isFinite(resultCount) || resultCount <= 0) return { kind: "noMatch" };
  // Threshold exceeded (index -1), or an index the count cannot contain:
  // report how many without claiming which.
  if (!Number.isFinite(resultIndex) || resultIndex < 0 || resultIndex >= resultCount) {
    return { kind: "countOnly", count: resultCount };
  }
  return { kind: "position", index: resultIndex + 1, count: resultCount };
}
