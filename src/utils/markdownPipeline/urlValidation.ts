/**
 * URL validation utilities for markdown pipeline
 *
 * Validates URLs to prevent XSS and other security issues.
 * Only allows safe URL schemes (http, https, mailto, tel, relative paths).
 *
 * @module utils/markdownPipeline/urlValidation
 */

/**
 * Allowed URL schemes for links and images.
 * - http/https: Standard web URLs
 * - mailto: Email links
 * - tel: Phone number links
 * - data: Data URIs (for inline images)
 * - Relative URLs are allowed (no scheme)
 */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "data:"]);

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

/**
 * Sanitize a URL by returning null for unsafe URLs.
 *
 * @param url - The URL to sanitize
 * @returns The original URL if safe, or null if unsafe
 *
 * @example
 * sanitizeUrl("https://example.com"); // "https://example.com"
 * sanitizeUrl("javascript:alert(1)"); // null
 */
export function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return isSafeUrl(url) ? url : null;
}

/**
 * Sanitize a URL with a fallback value.
 *
 * @param url - The URL to sanitize
 * @param fallback - Value to return if URL is unsafe (default: "about:blank")
 * @returns The original URL if safe, or the fallback if unsafe
 *
 * @example
 * sanitizeUrlWithFallback("https://example.com"); // "https://example.com"
 * sanitizeUrlWithFallback("javascript:alert(1)"); // "about:blank"
 */
export function sanitizeUrlWithFallback(
  url: string | null | undefined,
  fallback = "about:blank"
): string {
  if (!url) return fallback;
  return isSafeUrl(url) ? url : fallback;
}
