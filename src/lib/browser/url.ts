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
 * The display-side helpers live here too, because they are the same leaf-pure
 * URL parsing: `urlForAgent` / `originForAgent` (what an agent may be shown),
 * `urlForPersistence` (+ `credentialPath`, shared with the workflow recorder), and
 * `hostLabel` (the strip label for a page with no title). `parseNavigableUrl` is the
 * one navigable-URL parser every canonicalizer and the grant-pattern helper use.
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
  const url = parseNavigableUrl(input);
  if (url === null) return null;
  url.hash = ""; // drop the fragment (same document)
  return url.href;
}

/**
 * THE navigable-URL parser (round 3): http(s) only, host lowercased and punycoded
 * by `URL`, a trailing dot stripped, empty labels refused. `canonicalizeBrowserUrl`,
 * `canonicalizeBookmarkUrl` and the grant-pattern helper all parse through here —
 * three hand-rolled copies of these rules had already begun to differ in comments
 * and were one edit away from differing in behaviour. Returns a `URL` the caller
 * may keep mutating (fragment, password), or `null` when the input is not a
 * navigable web URL.
 */
export function parseNavigableUrl(input: string): URL | null {
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
  if (!host.startsWith("[") && host.split(".").some((label) => label === "")) return null;
  url.hostname = host; // write the trailing-dot-stripped host back
  return url;
}

/**
 * The URL as the **AI** may see it: scheme, host, port, and path — with userinfo,
 * query string, AND fragment removed.
 *
 * This URL crosses the trust boundary into the AI's `read`/`act`/`query` responses and
 * approval envelopes. Three parts of a URL routinely carry secrets the AI could not
 * otherwise read from the DOM, so all three are stripped:
 *   - **userinfo** (`user:pass@`) — an embedded credential;
 *   - **query** (`?access_token=…`) — OAuth callbacks, magic links, signed-document and
 *     password-reset URLs commonly put the secret here;
 *   - **fragment** (`#access_token=…`) — the OAuth *implicit* flow returns tokens in it.
 * Handing any of these to the AI would open a leak channel nothing else in the approval
 * model opens. The scheme/host/port/path that remain are enough for the AI to reason about
 * where it is; if it legitimately needs a query value it can read the rendered page.
 * (Security review P5, Medium #3 — extends the earlier userinfo-only redaction.)
 *
 * FAILS CLOSED (audit 2026-09-03 round 1): a URL that will not parse yields a placeholder,
 * not the raw string — an unparseable value can still carry a credential — and an OPAQUE
 * origin (`data:`/`blob:`/`about:`) exposes only its scheme, because a `data:` URL carries
 * its whole payload in what `URL` calls the path. The earlier rule returned both whole.
 */
export function urlForAgent(url: string): string {
  try {
    const parsed = new URL(url);
    // `about:blank` / `about:srcdoc` carry nothing; every other opaque origin
    // (`data:` above all) is reduced to its scheme.
    if (parsed.origin === "null" && !(parsed.protocol === "about:" && (parsed.pathname === "blank" || parsed.pathname === "srcdoc"))) {
      return `${parsed.protocol}(opaque)`;
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "(unparseable url)";
  }
}

/**
 * The **origin only** — `scheme://host[:port]`, no path/query/fragment/userinfo.
 *
 * Use this for an **approval envelope** the AI sees BEFORE it is authorized to read
 * the page: even the path can carry a credential (`/magic-login/<token>`,
 * `/reset/<token>`), so a pre-authorization prompt must not hand the AI more than
 * the origin it is being asked to approve an action against. `urlForAgent` (which
 * keeps the path) is fine for a POST-authorization read response, where the AI is
 * already reading the page anyway. (Security review P6, High.)
 *
 * FAILS CLOSED for an opaque origin: `data:`/`about:`/`blob:` serialise their origin
 * as `"null"`, and a `data:` URL carries its whole payload in the "path" — so we
 * expose only the SCHEME (`data:(opaque)`), never the payload. An unparseable input
 * yields a placeholder, not the raw string. (Security review P6 + re-verify, High.)
 */
export function originForAgent(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.origin === "null") return `${parsed.protocol}(opaque)`;
    return parsed.origin;
  } catch {
    return "(unknown origin)";
  }
}

/**
 * The URL as it may be **written to disk** (hot exit / session restore): the same page,
 * with any embedded password removed.
 *
 * A browser tab's URL is persisted into the workspace config so the tab can be restored.
 * `canonicalizeBrowserUrl` keeps userinfo on purpose — it is part of the tab's identity —
 * but a password inside it is a credential, and persisting it puts a secret in a cleartext
 * file that outlives the session that had a reason for it. Bookmarks already refuse to keep
 * one (`canonicalizeBookmarkUrl`); session restore did not.
 *
 * The **username stays**, and that is the same call bookmarks make: `alice@host` and
 * `bob@host` are different destinations, so dropping it would restore the wrong one. A
 * password is a credential; a username is an address.
 *
 * A URL that will not parse is returned unchanged — this is a redactor, not a validator.
 * (Audit, High.)
 */
export function urlForPersistence(url: string): string {
  try {
    const parsed = new URL(url);
    // A credential-bearing PATH — a reset, magic-login or invite link, or a long
    // opaque token segment — is kept as its origin only (round 3): the same rule the
    // recorder applies to a recorded workflow, for the same reason — the file
    // outlives the session that had a reason for the secret.
    if (credentialPath(parsed.pathname)) return `${parsed.origin}/`;
    let changed = false;
    if (parsed.password) {
      parsed.password = "";
      changed = true;
    }
    // Query and fragment parameters that NAME a credential are dropped too: OAuth
    // callbacks, magic links and reset URLs put the secret there, and a cleartext
    // session file outlives the reason for it. The rest of the query stays — a
    // search-results tab must still restore to its results.
    for (const params of [parsed.searchParams, new URLSearchParams(parsed.hash.replace(/^#/, ""))]) {
      const drop = [...params.keys()].filter((k) => CREDENTIAL_PARAM.test(k));
      if (drop.length === 0) continue;
      for (const k of drop) params.delete(k);
      changed = true;
      if (params === parsed.searchParams) continue;
      parsed.hash = params.toString();
    }
    return changed ? parsed.href : url;
  } catch {
    return url;
  }
}

/** Does this path carry a credential — a flow word (`reset`, `magic-login`, `invite`,
 *  `callback`…) or a long opaque token-shaped segment? Shared by persistence and the
 *  workflow recorder, so the two redactors cannot drift. */
export function credentialPath(pathname: string): boolean {
  return CREDENTIAL_PATH.test(pathname) || pathname.split("/").some((seg) => TOKEN_SEGMENT.test(seg));
}

/** Path words that name a credential-bearing flow. */
const CREDENTIAL_PATH = /(^|\/)(reset|reset-password|magic|magic-link|magic-login|token|verify|confirm|invite|activate|auth|callback|sso)(\/|$)/i;
/** A long opaque segment: hex, base64url or a random id — the shape a token takes. */
const TOKEN_SEGMENT = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{20,}$/;

/** Query/fragment parameter names that carry a credential rather than an address —
 *  tokens, secrets, and every common session-id spelling (`sid`, `sessid`,
 *  `jsessionid`, `phpsessid`, `asp.net_sessionid`…), OAuth verifiers and tickets. */
const CREDENTIAL_PARAM =
  /(^|_|-|\.)(token|access_token|id_token|refresh_token|oauth_token|oauth_verifier|bearer|jwt|secret|password|passwd|otp|auth|authorization|session|sessionid|sessid|sess|sid|jsessionid|phpsessid|aspsessionid|asp\.net_sessionid|cfid|cftoken|api_?key|apikey|signature|sig|code|ticket|nonce)($|_|-)/i;

/**
 * The label a tab wears for a page that has no `<title>`: the host (with a
 * non-default port), never the full URL. A tab record's `title` used to be set
 * once at creation and never again, so a tab that navigated away kept naming
 * its FIRST page — the strip read `duckduckgo.com` over a fixture at
 * `127.0.0.1` (seen in the chrome-controls journey's failure screenshot).
 * Unparseable input is returned as-is: a wrong label beats a blank one.
 */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
