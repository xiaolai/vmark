/**
 * Purpose: the find/replace bar's state, for plugins that highlight and replace.
 *
 * The fifth seam. The search bar is app CHROME — it lives outside the editor
 * and the user drives it — but the highlighting and replacing happen inside
 * plugins, on both surfaces. So the plugins need to read the query and report
 * how many matches they found, without owning the bar.
 *
 * An extension option cannot carry this: the same state is read from a
 * ProseMirror decoration pass and from CodeMirror replace actions, several
 * calls below either plugin's entry point.
 *
 * The default is a CLOSED bar with an empty query, which every caller already
 * treats as "nothing to highlight" — so a plugin lifted out of this repo
 * renders an editor with no search, rather than crashing.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/shared/hostSearch
 */

/** What a plugin needs to know about the find bar. */
export interface SearchQuery {
  isOpen: boolean;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  currentIndex: number;
  /** The replacement string — replace actions read it. */
  replaceText: string;
}

/** The find/replace state a plugin reads and reports into. */
export interface HostSearch {
  /** The current query, read fresh — the user retypes constantly. */
  current: () => SearchQuery;
  /** Report how many matches this surface found, and which is selected. */
  reportMatches: (count: number, index: number) => void;
  /** Advance to the next match — replace-and-find-next needs it. */
  findNext: () => void;
  /**
   * Subscribe to query changes; returns an unsubscribe.
   *
   * Highlighting must REDRAW as the user types, not merely read the new query
   * the next time a transaction happens to run.
   */
  onChange: (listener: () => void) => () => void;
}

/** A closed bar: every caller reads this as "nothing to highlight". */
const DEFAULTS: HostSearch = {
  current: () => ({
    isOpen: false,
    query: "",
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    currentIndex: 0,
    replaceText: "",
  }),
  reportMatches: () => {},
  findNext: () => {},
  onChange: () => () => {},
};

let bound: HostSearch = DEFAULTS;

/** Bind the host's find bar. Called once, at app startup. */
export function bindHostSearch(search: Partial<HostSearch>): void {
  bound = { ...DEFAULTS, ...search };
}

/** Restore defaults. Tests only. */
export function resetHostSearch(): void {
  bound = DEFAULTS;
}

/** The bound find bar, read through accessors so it is never captured stale. */
export const hostSearch: HostSearch = {
  current: () => bound.current(),
  reportMatches: (count, index) => bound.reportMatches(count, index),
  findNext: () => bound.findNext(),
  onChange: (listener) => bound.onChange(listener),
};
