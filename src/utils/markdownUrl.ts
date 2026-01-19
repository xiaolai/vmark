/**
 * Markdown URL Encoding Utility
 *
 * Handles URLs with spaces for markdown image/link syntax.
 * Uses angle brackets `<url>` for URLs with spaces (CommonMark standard).
 *
 * @module utils/markdownUrl
 */

/** Pattern matching whitespace characters that need special handling in markdown URLs */
const WHITESPACE_PATTERN = /[\s\u00A0\u2002-\u200A\u202F\u205F\u3000]/;

/**
 * Check if a URL contains whitespace that needs angle bracket wrapping.
 */
export function urlNeedsBrackets(url: string): boolean {
  if (!url) return false;
  return WHITESPACE_PATTERN.test(url);
}

/**
 * Encode a URL/path for safe use in markdown syntax.
 * Uses angle brackets for URLs with spaces (CommonMark standard).
 * This is more readable than percent-encoding.
 *
 * @param url - The URL or file path to encode
 * @returns The URL wrapped in <> if it contains spaces, otherwise as-is
 *
 * @example
 * encodeMarkdownUrl("/path/with spaces/file.png")
 * // "</path/with spaces/file.png>"
 *
 * encodeMarkdownUrl("/path/no-spaces.png")
 * // "/path/no-spaces.png"
 */
export function encodeMarkdownUrl(url: string): string {
  if (!url) return url;
  // Use angle brackets for URLs with whitespace (CommonMark standard)
  // This preserves exact characters and is more readable than %20
  if (urlNeedsBrackets(url)) {
    return `<${url}>`;
  }
  return url;
}

/**
 * Decode URL from markdown for file system access.
 * Strips angle brackets if present, and decodes percent-encoded characters
 * for backward compatibility with existing documents.
 *
 * @param url - The URL from markdown (may have <> or %20)
 * @returns The decoded path for file system access
 *
 * @example
 * decodeMarkdownUrl("</path/with spaces/file.png>")
 * // "/path/with spaces/file.png"
 *
 * decodeMarkdownUrl("/path/with%20spaces/file.png")
 * // "/path/with spaces/file.png"
 */
export function decodeMarkdownUrl(url: string): string {
  if (!url) return url;

  let decoded = url;

  // Strip angle brackets if present (from angle-bracket syntax)
  if (decoded.startsWith("<") && decoded.endsWith(">")) {
    decoded = decoded.slice(1, -1);
  }

  // Decode percent-encoded characters for backward compatibility
  // (existing documents may use %20 instead of angle brackets)
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // If decoding fails (malformed %), return as-is
  }

  return decoded;
}
