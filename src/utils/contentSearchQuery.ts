/**
 * Content search query length — the shortest query Find in Files and the
 * orphan-image check will send to the workspace content search.
 *
 * Key decisions:
 *   - Two characters: common CJK words are two characters long (#1598), and
 *     the search is bounded by its match/file caps and deadline anyway.
 *   - Counted in code points of the trimmed query, as the Rust commands
 *     count `chars()`: a lone emoji (two UTF-16 units) is one character.
 *
 * @coordinates-with src-tauri/src/content_search.rs — MIN_QUERY_CHARS, the same rule
 * @module utils/contentSearchQuery
 */

/** The shortest query, in characters, a content search runs. */
export const MIN_CONTENT_SEARCH_CHARS = 2;

/** Characters (code points) in the trimmed query. */
export function contentSearchQueryLength(query: string): number {
  return [...query.trim()].length;
}

/** Whether the query is long enough to search. */
export function isSearchableQuery(query: string): boolean {
  return contentSearchQueryLength(query) >= MIN_CONTENT_SEARCH_CHARS;
}
