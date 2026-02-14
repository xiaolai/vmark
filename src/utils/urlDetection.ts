/**
 * URL Detection and Normalization Utility
 *
 * Purpose: Detects valid URLs in text and normalizes them for link insertion.
 * Supports standard protocols (http, https, mailto, etc.) and custom app protocols.
 *
 * Key decisions:
 *   - Domain-like text (e.g., "example.com") auto-prepends https://
 *   - Custom protocols (obsidian://, vscode://) are recognized for app deep links
 *   - Validates TLD existence for bare domains to avoid false positives
 *
 * @coordinates-with smartPaste/tiptap.ts — auto-links pasted URLs
 * @coordinates-with linkCreatePopup/ — validates user-entered URLs
 * @module utils/urlDetection
 */

export interface UrlDetectionResult {
  isUrl: boolean;
  normalizedUrl: string | null;
  originalText: string;
}

/**
 * Standard protocols that are always recognized.
 * These don't require user configuration.
 */
const STANDARD_PROTOCOLS = [
  "http",
  "https",
  "mailto",
  "tel",
  "ftp",
  "sftp",
  "file",
];

/**
 * Regex to match bare email addresses (without mailto:).
 * e.g., user@example.com
 */
const BARE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Regex to match bare domains with path or common TLDs.
 * Must start with a valid domain character and contain at least one dot.
 * e.g., example.com, example.com/page, github.com/user/repo
 */
const BARE_DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/.*)?\s*$/i;

/**
 * Common TLDs for validating bare domains.
 * When domain has no path, we require a known TLD to avoid false positives.
 */
const COMMON_TLDS = new Set([
  "com", "org", "net", "edu", "gov", "io", "co", "dev", "app",
  "me", "info", "biz", "tv", "cc", "us", "uk", "de", "jp", "cn",
  "ai", "sh", "fm", "xyz", "tech", "blog", "cloud", "site", "online",
]);

/**
 * Check if text starts with a known protocol scheme.
 * Handles both standard and custom protocols.
 */
function hasProtocolScheme(
  text: string,
  customProtocols: string[] = []
): string | null {
  const allProtocols = [...STANDARD_PROTOCOLS, ...customProtocols];
  const lowerText = text.toLowerCase();

  for (const protocol of allProtocols) {
    if (lowerText.startsWith(`${protocol}://`) || lowerText.startsWith(`${protocol}:`)) {
      return text; // Return original text with scheme intact
    }
  }
  return null;
}

/**
 * Check if text is a bare email address.
 * Returns normalized mailto: URL if valid.
 */
function checkBareEmail(text: string): string | null {
  if (BARE_EMAIL_REGEX.test(text)) {
    return `mailto:${text}`;
  }
  return null;
}

/**
 * Check if text is a bare domain (with optional path).
 * Returns normalized https:// URL if valid.
 */
function checkBareDomain(text: string): string | null {
  if (!BARE_DOMAIN_REGEX.test(text)) {
    return null;
  }

  // Check if domain has a path (e.g., example.com/page)
  const hasPath = text.includes("/");

  if (!hasPath) {
    // For domains without path, require a common TLD
    const parts = text.split(".");
    const tld = parts[parts.length - 1].toLowerCase();
    if (!COMMON_TLDS.has(tld)) {
      return null;
    }
  }

  return `https://${text}`;
}

/**
 * Check if text is a localhost URL.
 * Returns normalized http:// URL if valid.
 */
function checkLocalhost(text: string): string | null {
  const localhostPattern = /^localhost(:\d+)?(\/.*)?$/i;
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/;

  if (localhostPattern.test(text)) {
    return `http://${text}`;
  }
  if (ipPattern.test(text)) {
    return `http://${text}`;
  }
  return null;
}

/**
 * Detect and normalize a URL from text.
 * Handles various URL formats and normalizes them for link insertion.
 *
 * @param text - The text to check for URL patterns
 * @param customProtocols - Additional protocol schemes to recognize (e.g., ["obsidian", "vscode"])
 * @returns Detection result with normalized URL or null
 *
 * @example
 * detectAndNormalizeUrl("https://example.com") // { isUrl: true, normalizedUrl: "https://example.com", ... }
 * detectAndNormalizeUrl("user@example.com")    // { isUrl: true, normalizedUrl: "mailto:user@example.com", ... }
 * detectAndNormalizeUrl("example.com/page")    // { isUrl: true, normalizedUrl: "https://example.com/page", ... }
 * detectAndNormalizeUrl("hello world")         // { isUrl: false, normalizedUrl: null, ... }
 */
export function detectAndNormalizeUrl(
  text: string,
  customProtocols: string[] = []
): UrlDetectionResult {
  const trimmed = text.trim();

  // Empty text is not a URL
  if (!trimmed) {
    return { isUrl: false, normalizedUrl: null, originalText: text };
  }

  // Only use the first line (for multi-line clipboard content)
  const firstLine = trimmed.split("\n")[0].trim();
  if (!firstLine) {
    return { isUrl: false, normalizedUrl: null, originalText: text };
  }

  // 1. Check for explicit protocol scheme
  const withScheme = hasProtocolScheme(firstLine, customProtocols);
  if (withScheme) {
    return { isUrl: true, normalizedUrl: withScheme, originalText: text };
  }

  // 2. Check for bare email
  const email = checkBareEmail(firstLine);
  if (email) {
    return { isUrl: true, normalizedUrl: email, originalText: text };
  }

  // 3. Check for localhost/IP
  const localhost = checkLocalhost(firstLine);
  if (localhost) {
    return { isUrl: true, normalizedUrl: localhost, originalText: text };
  }

  // 4. Check for bare domain with path or common TLD
  const domain = checkBareDomain(firstLine);
  if (domain) {
    return { isUrl: true, normalizedUrl: domain, originalText: text };
  }

  // Not a recognized URL pattern
  return { isUrl: false, normalizedUrl: null, originalText: text };
}

/**
 * Truncate a URL for display, keeping it readable.
 * Preserves domain and end of path for context.
 *
 * @param url - The URL to truncate
 * @param maxLength - Maximum length before truncating (default: 60)
 * @returns Truncated URL with ellipsis if needed
 *
 * @example
 * truncateUrl("https://example.com/very/long/path/to/resource")
 * // "https://example.com/very/lo...th/to/resource"
 */
export function truncateUrl(url: string, maxLength = 60): string {
  if (url.length <= maxLength) return url;

  // Keep the domain and end of path visible
  const start = url.slice(0, 30);
  const end = url.slice(-25);
  return `${start}...${end}`;
}

/**
 * Quick check if text looks like a URL (without full normalization).
 * Useful for fast filtering before detailed detection.
 */
export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Check for common URL indicators
  return (
    trimmed.includes("://") ||
    trimmed.includes("@") ||
    trimmed.includes(".com") ||
    trimmed.includes(".org") ||
    trimmed.includes(".net") ||
    trimmed.includes(".io") ||
    trimmed.startsWith("localhost")
  );
}
