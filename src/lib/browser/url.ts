/**
 * Browser URL canonicalization.
 *
 * Purpose: produce a stable canonical form of a navigable http(s) URL so that
 * browser tabs can be deduplicated ("is this URL already open?") and persisted
 * deterministically (WI-1.1 / R1). This is a leaf-pure utility — no store, no
 * Tauri — built on the platform `URL` parser, which handles punycode/IDN and
 * default-port normalization for us.
 *
 * Canonicalization rules (dedup-oriented, deliberately lossy):
 *   - Only http/https URLs are navigable browser targets; anything else → null.
 *   - Scheme and host are lowercased (via `URL`); IDN hosts are punycoded.
 *   - Default ports (80/443) are dropped.
 *   - A trailing dot on the host is stripped; empty-label hosts are rejected.
 *   - The fragment (`#…`) is dropped: it addresses a location *within* the same
 *     document, so `page#a` and `page#b` are the same tab for dedup purposes.
 *   - Path and query are preserved as the `URL` parser normalizes them.
 *
 * @module lib/browser/url
 */

const DEFAULT_PORTS: Record<string, number> = {
  "http:": 80,
  "https:": 443,
};

/**
 * Canonicalize a navigable http(s) URL to a stable string, or `null` if the
 * input is not a navigable web URL (opaque scheme, missing/empty host, or
 * unparseable). The returned string is suitable both as a dedup key and as the
 * value stored on a `BrowserTab`.
 */
export function canonicalizeBrowserUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const defaultPort = DEFAULT_PORTS[url.protocol];
  if (defaultPort === undefined) return null; // only http/https are navigable

  // URL lowercases scheme/host and punycodes IDN; it does NOT strip a trailing dot.
  const host = url.hostname.replace(/\.$/, "");
  if (host === "") return null;
  // Reject empty labels (`https://..`, `https://.com`). IPv6 literals ("[::1]")
  // are a single bracketed label and pass unaffected.
  if (!host.startsWith("[") && host.split(".").some((label) => label === "")) {
    return null;
  }

  const scheme = url.protocol; // includes trailing ":"
  const port = url.port === "" || Number(url.port) === defaultPort ? "" : `:${url.port}`;
  // url.pathname is always at least "/"; url.search is "" or "?...".
  return `${scheme}//${host}${port}${url.pathname}${url.search}`;
}
