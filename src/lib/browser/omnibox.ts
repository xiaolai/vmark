/**
 * Browser omnibox resolution (WI-S1.5).
 *
 * The address bar is an *omnibox*: a single field that accepts either a URL to
 * navigate to or a search query. This leaf-pure module classifies the entry and
 * returns the URL to load — no store, no Tauri.
 *
 * Classification (the standard omnibox heuristic):
 *   - Blank → "" (caller navigates nowhere).
 *   - Explicit `http(s)://…` → navigate as-is (fragment preserved).
 *   - A bare host that *looks* like one — `example.com`, `sub.d.co/x`,
 *     `localhost:3000`, an IPv4 literal — with no whitespace → navigate,
 *     defaulting the scheme (loopback → http for dev servers, everything else →
 *     https).
 *   - Anything else (contains a space, or a single dotless word) → a search on the
 *     default provider.
 *
 * @coordinates-with lib/browser/url — canonicalizeBrowserUrl (dedup-oriented, drops fragment)
 * @module lib/browser/omnibox
 */
import { canonicalizeBrowserUrl } from "./url";

/** Default search provider — same neutral, privacy-respecting engine as the new-tab page. */
const SEARCH_URL_BASE = "https://duckduckgo.com/";

/**
 * Canonicalize a navigation target while PRESERVING its fragment (`#section`).
 *
 * `canonicalizeBrowserUrl` is dedup-oriented and deliberately drops the fragment,
 * but navigation must keep it so the page scrolls to the anchor — otherwise
 * entering or reloading `page#section` silently loads `page`. Falls back to the raw
 * input when it is not a navigable http(s) URL (about:blank, a scheme-less draft) so
 * the tab still reaches the native side.
 */
export function navigationTarget(input: string): string {
  const canonical = canonicalizeBrowserUrl(input);
  if (canonical === null) return input;
  const hashIndex = input.indexOf("#");
  return hashIndex >= 0 ? canonical + input.slice(hashIndex) : canonical;
}

/** The host part of a bare entry (before any path/query/fragment). */
function hostOf(entry: string): string {
  return entry.split(/[/?#]/, 1)[0];
}

/** A real IPv4 loopback address — `127.x.x.x`, all four octets numeric.
 *
 *  NOT `/^127\./`. That matches `127.evil.com`, which is a perfectly registrable domain
 *  name: an attacker who owns it would get their host silently DOWNGRADED from https to
 *  http, and the user would never see it happen. A prefix test on a hostname is not an
 *  IP test. */
const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Loopback hosts get http (dev servers rarely have https certs); everything else https. */
function schemeFor(entry: string): "http" | "https" {
  const host = hostOf(entry).split(":", 1)[0].toLowerCase();
  if (host === "localhost" || host === "::1" || host === "[::1]" || IPV4_LOOPBACK.test(host)) {
    return "http";
  }
  return "https";
}

/** True if `entry` reads as a bare host (no scheme, no whitespace) worth navigating to. */
function looksLikeBareHost(entry: string): boolean {
  if (/\s/.test(entry)) return false;
  const host = hostOf(entry);
  if (host === "localhost" || /^localhost:\d+$/.test(host)) return true;
  // domain.tld (optionally sub-labelled, optionally with a port).
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host)) return true;
  // IPv4 literal, optionally with a port.
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;
  return false;
}

/**
 * Resolve an omnibox entry to the URL to load, or "" for blank input.
 * See the module header for the classification rules.
 */
export function resolveOmnibox(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return navigationTarget(trimmed);
  }
  if (looksLikeBareHost(trimmed)) {
    return navigationTarget(`${schemeFor(trimmed)}://${trimmed}`);
  }
  return `${SEARCH_URL_BASE}?q=${encodeURIComponent(trimmed)}`;
}
