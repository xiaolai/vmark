/**
 * URL Validation Utilities
 *
 * Purpose: Validates URLs to prevent XSS via dangerous schemes (javascript:, vbscript:, etc.).
 * Used at the MDAST → PM boundary to sanitize all link/image hrefs.
 *
 * Key decisions:
 *   - Allowlist approach: only known-safe schemes are permitted
 *   - file: intentionally blocked — Tauri uses asset:/tauri: protocols instead
 *   - Relative URLs (no scheme) are always allowed
 *   - Empty/null URLs are treated as safe (schema handles them)
 *   - Slash-before-colon detection prevents false blocking of paths like "path/to:file"
 *
 * @coordinates-with mdastInlineConverters.ts — calls isSafeUrl for link/image conversion
 * @coordinates-with shared/mediaSecurity.ts — additional image-specific URL validation
 * @module utils/markdownPipeline/urlValidation
 */

/**
 * Allowed URL schemes for links and images.
 * - http/https: Standard web URLs
 * - mailto: Email links
 * - tel: Phone number links
 * - data: Data URIs (for inline images)
 * - asset/tauri: Tauri asset protocol (for local files)
 * - Relative URLs are allowed (no scheme)
 *
 * Note: file: URLs are intentionally blocked for security.
 * Use asset: or tauri: protocols for local file access.
 */
const ALLOWED_SCHEMES = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
  "data:",
  "asset:",
  "tauri:",
]);

/**
 * Check if a URL has a safe scheme.
 *
 * Rejects potentially dangerous schemes like javascript:, vbscript:, etc.
 * Allows relative URLs and URLs with safe schemes.
 *
 * @param url - The URL to validate
 * @returns true if the URL is safe, false otherwise
 *
 * @example
 * isSafeUrl("https://example.com"); // true
 * isSafeUrl("/path/to/page"); // true
 * isSafeUrl("javascript:alert(1)"); // false
 */
export function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return true; // Empty URLs are safe (will be handled by schema)

  // Trim and lowercase for comparison
  const trimmed = url.trim();
  if (!trimmed) return true;

  // Check for scheme
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex === -1) {
    // No scheme - relative URL, safe
    return true;
  }

  // Check if there's a slash before the colon (path segment, not scheme)
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex !== -1 && slashIndex < colonIndex) {
    // Slash before colon - relative URL with colon in path, safe
    return true;
  }

  // Extract and validate scheme
  const scheme = trimmed.slice(0, colonIndex + 1).toLowerCase();
  return ALLOWED_SCHEMES.has(scheme);
}