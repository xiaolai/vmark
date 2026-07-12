/**
 * Purpose: Origin canonicalization and grant matching — the enforcement core of
 * the embedded browser's security invariant (R4 / I3 / R7a).
 *
 * The driver (Rust) is the authoritative enforcement point, but the canonicalization
 * RULES live here as the single testable specification so the Rust guard and this TS
 * layer cannot drift. A grant confers authority (read, and via plugins, publish), so
 * every rule below is a security boundary:
 *   - scheme + host + port only (userinfo/path/query/hash discarded)
 *   - host is IDN→punycode, lowercased, trailing dot stripped
 *   - default ports normalized (443/80)
 *   - only http/https are navigable origins; data:/blob:/about:/file:/ws: are opaque → null
 *   - NO implicit subdomain wildcarding — a pattern must write `*.host` to cover subdomains
 *   - `*.example.com` covers strict subdomains at any depth, NOT the apex, NOT look-alikes
 *
 * @coordinates-with src-tauri/src/browser/origin_guard.rs (must mirror these rules)
 */

const DEFAULT_PORTS: Record<string, number> = {
  "https:": 443,
  "http:": 80,
};

export interface CanonicalOrigin {
  /** Lowercased scheme without the trailing colon, e.g. "https". */
  scheme: string;
  /** Punycode ASCII host, lowercased, trailing dot stripped. */
  host: string;
  /** Explicit port with default ports (443/80) filled in. */
  port: number;
}

/** Stable string key for a canonical origin: `scheme://host:port`. */
export function originKey(o: CanonicalOrigin): string {
  return `${o.scheme}://${o.host}:${o.port}`;
}

/**
 * Parse an input URL into a canonical web origin, or `null` if it is not a
 * navigable http(s) origin (opaque scheme, missing host, or unparseable).
 */
export function canonicalizeOrigin(input: string): CanonicalOrigin | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const defaultPort = DEFAULT_PORTS[url.protocol];
  if (defaultPort === undefined) return null; // only http/https are navigable origins

  // The URL constructor punycodes IDN hosts and lowercases scheme/host for us.
  // It does NOT strip a trailing dot — do that explicitly.
  const host = url.hostname.replace(/\.$/, "");
  if (host === "") return null;
  // Reject empty labels (`https://..`, `https://.com`, `https://a..b.com`) — these
  // survive URL parsing as e.g. "." but are not real hosts. IPv6 literals like
  // "[::1]" are a single bracketed label and pass unaffected.
  if (!host.startsWith("[") && host.split(".").some((label) => label === "")) return null;

  // URL yields "" for a default port; otherwise the explicit numeric port.
  const port = url.port === "" ? defaultPort : Number(url.port);

  return { scheme: url.protocol.replace(/:$/, ""), host, port };
}

/** A parsed grant pattern: a canonical base origin plus whether it is a subdomain wildcard. */
interface ParsedPattern {
  origin: CanonicalOrigin;
  wildcard: boolean;
}

/**
 * Parse a grant pattern (`https://host`, `https://host:port`, or `https://*.host`)
 * into a canonical base origin + wildcard flag, or null if malformed. Single source
 * of truth for both matching and validation, so the two cannot drift.
 *
 * SECURITY: a pattern must be a BARE origin. Userinfo, path, query, or fragment are
 * rejected — not stripped — because the URL parser would otherwise silently
 * reinterpret `https://*.example.com@evil.com` as authority `evil.com`. A target URL
 * legitimately carries those parts (it is a real navigated URL); a grant pattern must
 * not, so patterns get stricter parsing than targets.
 */
function parseOriginPattern(pattern: string): ParsedPattern | null {
  const trimmed = pattern.trim();
  if (trimmed === "") return null;

  let wildcard = false;
  let candidate = trimmed;

  const marker = "://*.";
  const idx = trimmed.indexOf(marker);
  if (idx !== -1) {
    wildcard = true;
    const scheme = trimmed.slice(0, idx);
    const base = trimmed.slice(idx + marker.length);
    if (base === "" || base.startsWith(".")) return null;
    candidate = `${scheme}://${base}`;
  }
  if (candidate.includes("*")) return null; // stray wildcard (`https://*`, `https://ex*ample.com`)

  // Reject any pattern that is not a bare origin.
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.search !== "" || url.hash !== "") return null;

  const origin = canonicalizeOrigin(candidate);
  return origin === null ? null : { origin, wildcard };
}

/** Is `pattern` a well-formed grant pattern the driver could enforce? */
export function isOriginPattern(pattern: string): boolean {
  return parseOriginPattern(pattern) !== null;
}

/** A described grant pattern: its canonical base origin fields plus the wildcard flag. */
export interface OriginPatternInfo {
  wildcard: boolean;
  scheme: string;
  /** For a wildcard, the base host (the part after `*.`); otherwise the exact host. */
  host: string;
  port: number;
}

/**
 * Describe a grant pattern for consumers (e.g. the site registry) that need its
 * canonical parts without re-implementing wildcard parsing. Returns null if invalid.
 * Single source of truth — callers must not re-derive `wildcard`/`host` themselves.
 */
export function describeOriginPattern(pattern: string): OriginPatternInfo | null {
  const parsed = parseOriginPattern(pattern);
  if (parsed === null) return null;
  return {
    wildcard: parsed.wildcard,
    scheme: parsed.origin.scheme,
    host: parsed.origin.host,
    port: parsed.origin.port,
  };
}

/**
 * Does a canonical target origin match a grant pattern?
 *
 * Matching is exact on scheme and port; the host is either exact, or (for `*.base`)
 * a strict subdomain of `base` — never the apex, never a look-alike suffix.
 */
export function originMatchesPattern(target: CanonicalOrigin, pattern: string): boolean {
  const parsed = parseOriginPattern(pattern);
  if (parsed === null) return false;

  if (target.scheme !== parsed.origin.scheme) return false;
  if (target.port !== parsed.origin.port) return false;

  if (parsed.wildcard) {
    return target.host.endsWith(`.${parsed.origin.host}`);
  }
  return target.host === parsed.origin.host;
}

/**
 * Is the target URL granted by at least one pattern in the grant set?
 * Default-deny: an empty grant set, or a target that is not a navigable origin,
 * grants nothing.
 */
export function isOriginGranted(targetUrl: string, grants: readonly string[]): boolean {
  const target = canonicalizeOrigin(targetUrl);
  if (target === null) return false;
  return grants.some((pattern) => originMatchesPattern(target, pattern));
}
