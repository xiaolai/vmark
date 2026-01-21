/**
 * Utility functions for source editor search functionality.
 */

/**
 * Escape special regex characters in a string.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Count matches in the document text.
 * Used to update the search store's match count in source mode.
 */
export function countMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): number {
  if (!query) return 0;

  const flags = caseSensitive ? "g" : "gi";
  let pattern: string;

  if (useRegex) {
    pattern = query;
    // In regex mode, wholeWord is ignored (user handles it manually)
  } else {
    pattern = escapeRegExp(query);
    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    // Invalid regex
    return 0;
  }

  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    count++;
    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) regex.lastIndex++;
  }

  return count;
}
