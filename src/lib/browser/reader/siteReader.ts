/**
 * Pluggable page readers + publishers (WI-3.3).
 *
 * ⚠️ **NOT WIRED — no production caller.** `createDraft` is documented as "never a live
 * post", but nothing in the type or the driver enforces draft-only; that must be a
 * capability the authoritative side checks before this is wired. (Branch audit.)
 *
 * Purpose: the plugin contract that lets a site opt into a bespoke reader (or
 * publisher) while everything else falls back to the generic reader (WI-2.4).
 * A `SiteReader` is chosen by URL match; the built-in `genericReader` matches
 * any http(s) page. This keeps the common case zero-config and the special
 * cases (a site whose DOM the generic heuristic mangles) a small, isolated
 * plugin — hardened against a fixture corpus in WI-3.2.
 *
 * The `SitePublisher` contract is declared here for symmetry, but a real
 * publisher needs the driver's credentialed same-origin fetch (ADR-S4) and is
 * draft-first (never auto-publishes) — its implementation lands in WI-3.4.
 *
 * @coordinates-with lib/browser/reader/reader.ts — the generic readPage backend
 * @coordinates-with lib/sites/registry.ts — site manifests gate which plugins load
 * @module lib/browser/reader/siteReader
 */

import { canonicalizeBrowserUrl } from "../url";
import { readPage, type ReaderResult } from "./reader";

/** A pluggable reader: matches some set of URLs and renders their DOM. */
export interface SiteReader {
  id: string;
  /** Whether this reader handles the given URL. */
  match: (url: string) => boolean;
  /** Read the captured page HTML into a reader result. */
  read: (html: string, url: string) => ReaderResult;
}

/** Input to a draft-creating publish operation. */
export interface PublishInput {
  title: string;
  markdown: string;
  /** Extra site-specific fields (tags, collection, visibility, …). */
  meta?: Record<string, unknown>;
}

/** The outcome of a draft-first publish (never a live post in v1). */
export interface PublishResult {
  /** Where the created draft can be reviewed. */
  draftUrl: string | null;
  /** An idempotency correlation key for the created draft (R8a). */
  correlationKey: string;
}

/**
 * A pluggable publisher (WI-3.4 implements one). Draft-first by contract: it
 * creates a reviewable draft via the platform's own web API from a page that
 * already holds the user's session — it never publishes without confirmation.
 */
export interface SitePublisher {
  id: string;
  match: (url: string) => boolean;
  createDraft: (input: PublishInput, targetUrl: string) => Promise<PublishResult>;
}

/** The built-in generic reader — matches any navigable http(s) URL, uses `readPage`.
 *  Matching goes through the canonical URL parser, not a string prefix: `https://`
 *  and `https:// not-a-host` look like http(s) but are not pages. */
export const genericReader: SiteReader = {
  id: "generic",
  match: (url) => canonicalizeBrowserUrl(url) !== null,
  read: (html, url) => readPage(html, url),
};

/**
 * Whether `reader` claims `url`. A site reader is third-party code: a matcher that
 * throws must not abort selection — later readers and the generic fallback still
 * get their turn, and the faulty plugin simply does not match.
 */
function claims(reader: SiteReader, url: string): boolean {
  try {
    return reader.match(url) === true;
  } catch {
    return false;
  }
}

/**
 * Pick the reader for a URL: the first matching site-specific reader (in
 * registration order), else the generic reader — or `null` when nothing can read
 * the URL (e.g. `file:///…`). Never returns a reader whose own matcher says it
 * cannot handle the URL.
 */
export function pickReader(url: string, readers: readonly SiteReader[]): SiteReader | null {
  for (const reader of readers) {
    if (claims(reader, url)) return reader;
  }
  return claims(genericReader, url) ? genericReader : null;
}
