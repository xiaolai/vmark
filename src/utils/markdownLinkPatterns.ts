/**
 * Markdown Link Patterns
 *
 * Centralized regex patterns for detecting markdown links.
 * Used by source mode popups, adapters, and inline detection.
 */

/**
 * Regex to match markdown links: [text](url) or [text](url "title")
 * Supports angle-bracket URLs: [text](<url with spaces>)
 *
 * Groups:
 * - [1]: Link text
 * - [2]: Angle-bracket URL (if present)
 * - [3]: Regular URL (if no angle brackets)
 *
 * Does NOT match images - caller must check for preceding `!`
 */
export const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"[^"]*")?\)/g;

/**
 * Regex to match wiki links: [[target]] or [[target|alias]]
 *
 * Groups:
 * - [1]: Target (required)
 * - [2]: Alias (optional)
 */
export const WIKI_LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Result of finding a markdown link at a position.
 */
export interface MarkdownLinkMatch {
  from: number;
  to: number;
  text: string;
  url: string;
  fullMatch: string;
}

/**
 * Result of finding a wiki link at a position.
 */
export interface WikiLinkMatch {
  from: number;
  to: number;
  target: string;
  alias: string | null;
  fullMatch: string;
}

/**
 * Find all markdown links in a line of text.
 *
 * @param lineText - The text to search
 * @param lineStart - The document offset where this line begins
 * @param skipImages - If true, skip matches preceded by `!` (default: true)
 * @returns Array of link matches with document positions
 */
export function findMarkdownLinksInLine(
  lineText: string,
  lineStart: number,
  skipImages = true
): MarkdownLinkMatch[] {
  const results: MarkdownLinkMatch[] = [];
  const regex = new RegExp(MARKDOWN_LINK_REGEX.source, "g");

  let match;
  while ((match = regex.exec(lineText)) !== null) {
    // Skip if this is an image (preceded by !)
    if (skipImages && match.index > 0 && lineText[match.index - 1] === "!") {
      continue;
    }

    results.push({
      from: lineStart + match.index,
      to: lineStart + match.index + match[0].length,
      text: match[1],
      url: match[2] || match[3],
      fullMatch: match[0],
    });
  }

  return results;
}

/**
 * Find all wiki links in a line of text.
 *
 * @param lineText - The text to search
 * @param lineStart - The document offset where this line begins
 * @returns Array of wiki link matches with document positions
 */
export function findWikiLinksInLine(lineText: string, lineStart: number): WikiLinkMatch[] {
  const results: WikiLinkMatch[] = [];
  const regex = new RegExp(WIKI_LINK_REGEX.source, "g");

  let match;
  while ((match = regex.exec(lineText)) !== null) {
    results.push({
      from: lineStart + match.index,
      to: lineStart + match.index + match[0].length,
      target: match[1],
      alias: match[2] || null,
      fullMatch: match[0],
    });
  }

  return results;
}

/**
 * Find markdown link at a specific position.
 *
 * @param lineText - The text to search
 * @param lineStart - The document offset where this line begins
 * @param pos - The position to check (document offset)
 * @returns The link match if position is inside a link, null otherwise
 */
export function findMarkdownLinkAtPosition(
  lineText: string,
  lineStart: number,
  pos: number
): MarkdownLinkMatch | null {
  const links = findMarkdownLinksInLine(lineText, lineStart);
  return links.find((link) => pos >= link.from && pos < link.to) ?? null;
}

/**
 * Find wiki link at a specific position.
 *
 * @param lineText - The text to search
 * @param lineStart - The document offset where this line begins
 * @param pos - The position to check (document offset)
 * @returns The wiki link match if position is inside a link, null otherwise
 */
export function findWikiLinkAtPosition(
  lineText: string,
  lineStart: number,
  pos: number
): WikiLinkMatch | null {
  const links = findWikiLinksInLine(lineText, lineStart);
  return links.find((link) => pos >= link.from && pos < link.to) ?? null;
}
