/**
 * Browser URL canonicalization.
 *
 * Purpose: produce a stable canonical form of a navigable http(s) URL so that
 * browser tabs can be deduplicated ("is this URL already open?") and persisted
 * deterministically (WI-1.1 / R1). This is a leaf-pure utility — no store, no
 * Tauri — built on the platform `URL` parser, which handles punycode/IDN and
 * default-port normalization for us.
 *
 * Canonicalization rules (dedup-oriented, deliberately lossy in ONE dimension):
 *   - Only http/https URLs are navigable browser targets; anything else → null.
 *   - Scheme and host are lowercased (via `URL`); IDN hosts are punycoded.
 *   - Default ports (80/443) are dropped (by the `URL` parser).
 *   - A trailing dot on the host is stripped; empty-label hosts are rejected.
 *   - The fragment (`#…`) is dropped — the ONLY lossy rule: a fragment addresses a
 *     location *within* the same document, so `page#a` and `page#b` are the same
 *     tab for dedup purposes.
 *   - Everything else the URL carries is preserved by re-serializing the parsed
 *     `URL` (`href`) rather than rebuilding the string by hand. In particular
 *     **userinfo is kept**: `https://alice@host/x` and `https://bob@host/x` are
 *     different tabs and must not dedup together (and dropping the credentials
 *     would silently navigate somewhere the user did not ask for). An empty query
 *     delimiter (`/path?`) survives too — the server, not this module, decides
 *     whether it is meaningful.
 *
 * @module lib/browser/url
 */

/** Only these schemes are navigable browser targets. */
const NAVIGABLE_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

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

  if (!NAVIGABLE_PROTOCOLS.has(url.protocol)) return null;

  // URL lowercases scheme/host and punycodes IDN; it does NOT strip a trailing dot.
  const host = url.hostname.replace(/\.$/, "");
  if (host === "") return null;
  // Reject empty labels (`https://..`, `https://.com`). IPv6 literals ("[::1]")
  // are a single bracketed label and pass unaffected.
  if (!host.startsWith("[") && host.split(".").some((label) => label === "")) {
    return null;
  }

  url.hostname = host; // write the trailing-dot-stripped host back
  url.hash = ""; // drop the fragment (same document)
  return url.href;
}

/**
 * The URL as the **AI** may see it: the same page, with any embedded credentials removed.
 *
 * `canonicalizeBrowserUrl` keeps userinfo deliberately — it is part of a tab's identity,
 * and dropping it would navigate somewhere the user did not ask for. But the URL also
 * crosses the trust boundary into the AI's `read`/`act` responses, and credentials in a URL
 * are the one thing about a page the AI could not otherwise obtain by reading the DOM.
 * Handing them over would open a leak channel that nothing else in the approval model opens.
 *
 * The username goes too, not just the password: it names an account, and the AI has no use
 * for it that reading the page would not already serve. Everything the AI legitimately needs
 * to reason about where it is — scheme, host, port, path, query, fragment — is preserved.
 *
 * A URL that will not parse is returned unchanged: this is a redactor, not a validator, and
 * inventing a value here would hide the real one from the caller. (Audit, High.)
 */
export function urlForAgent(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch {
    return url;
  }
}
