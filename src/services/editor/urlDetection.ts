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
/**
 * Schemes that must never be treated as URLs (XSS vectors).
 */
const BLOCKED_SCHEMES = new Set(["javascript", "vbscript", "data"]);

/**
 * Schemes that require `://` authority syntax.
 * Others (mailto, tel) use `scheme:` without `//`.
 */
const AUTHORITY_SCHEMES = new Set(["http", "https", "ftp", "sftp", "file"]);

function hasProtocolScheme(
  text: string,
  customProtocols: string[] = []
): string | null {
  const allProtocols = [...STANDARD_PROTOCOLS, ...customProtocols];
  const lowerText = text.toLowerCase();

  for (const protocol of allProtocols) {
    if (BLOCKED_SCHEMES.has(protocol.toLowerCase())) continue;
    if (AUTHORITY_SCHEMES.has(protocol)) {
      // Authority-based schemes require ://
      if (lowerText.startsWith(`${protocol}://`)) return text;
    } else {
      // Non-authority schemes (mailto, tel, custom) use scheme:
      if (lowerText.startsWith(`${protocol}://`) || lowerText.startsWith(`${protocol}:`)) {
        return text;
      }
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
  const ipPattern = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)(:\d+)?(\/.*)?$/;

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
  /* v8 ignore next -- @preserve structurally unreachable: trimmed.split("\n")[0] is non-empty after !trimmed guard */
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
