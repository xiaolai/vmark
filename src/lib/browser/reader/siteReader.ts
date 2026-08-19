/**
 * Pluggable page readers (WI-3.3).
 *
 * Purpose: the plugin contract that lets a site opt into a bespoke reader while
 * everything else falls back to the generic one (WI-2.4). A `SiteReader` is
 * chosen by URL match; the built-in `genericReader` matches any http(s) page.
 * This keeps the common case zero-config and the special cases (a site whose DOM
 * the generic heuristic mangles) a small, isolated plugin — hardened against a
 * fixture corpus.
 *
 * WIRED (WI-NB4.1/4.2): `browser_read.extract` is the production consumer.
 * Readers register ATOMICALLY with their manifest (`registerSite(manifest,
 * reader)`), and `registry.readerForUrl` is the dispatch point — origin
 * security from `dispatchSite`, URL refinement from the reader's own `match`,
 * `genericReader` as the fallback. `health.ts` was deleted in the same pass
 * (WI-NB4.4): its probe contract had no honest consumer without the
 * credentialed site flows that left with `SitePublisher`.
 *
 * PUBLISHING WAS REMOVED (WI-DP1.2, 2026-08-09). `SitePublisher`, `PublishInput`
 * and `PublishResult` were declared here "for symmetry" against an
 * implementation that would land in WI-3.4. Nothing ever imported them, and the
 * header's own warning said the draft-only guarantee was documented but
 * unenforced by either the type or the driver. A contract with no implementation
 * and no caller is not symmetry, it is a promise the compiler cannot keep — so
 * it is gone rather than frozen in a baseline. Re-introduce it with the driver's
 * credentialed same-origin fetch (ADR-S4) and a real draft-only check when a
 * publisher is actually built.
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
