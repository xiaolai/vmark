/**
 * Bookmark identity (WI-S3.1).
 *
 * A bookmark is a promise to take the user back to exactly what they saw. Canonicalization
 * therefore normalizes only what is genuinely meaningless, and preserves everything else —
 * including the parts it is tempting to "clean up".
 *
 * **Normalized** (the same destination, spelled differently):
 *   - scheme and host case, and IDN → punycode (the `URL` parser does both)
 *   - a default port (`:443` on https, `:80` on http)
 *   - a trailing dot on the host
 *
 * **Preserved, deliberately:**
 *   - the **path** — the v2 plan deduped with the origin guard's `canonicalizeOrigin`,
 *     which discards it, so every page on a host would have collapsed into one bookmark.
 *   - the **query, exactly, in order, with duplicate keys**. Sorting parameters would merge
 *     urls a server may treat as different. Stripping "tracking" params is a guess about
 *     what the user meant, and a url with `utm_*` may genuinely resolve differently. Neither
 *     is ours to do: it rewrites what the user asked to remember.
 *   - the **fragment**. This is the one place bookmark identity departs from *tab* identity:
 *     a tab treats `page#a` and `page#b` as the same document (they are), but someone who
 *     bookmarks a section asked for that section.
 *   - **the username**, if any — `alice@host` and `bob@host` are different destinations.
 *
 * **Stripped:** the **password**. A bookmark is written to disk in cleartext and rendered
 * in the sidebar; keeping `https://alice:hunter2@host/x` would persist a credential the
 * user never asked us to store and then display it. The username is kept because it is
 * part of the destination; the secret is not ours to keep.
 *
 * Leaf-pure: platform `URL` only, no stores, no Tauri.
 *
 * @coordinates-with lib/browser/url — the TAB canonicalizer, which DOES drop the fragment
 * @module lib/browser/bookmarkUrl
 */

/** Only these can be bookmarked. `javascript:` and `file:` are refused outright. */
const BOOKMARKABLE_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * The canonical identity of a bookmark, or `null` if the input cannot be one.
 *
 * Two urls that produce the same string are the same bookmark; two that do not, are not.
 */
export function canonicalizeBookmarkUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (!BOOKMARKABLE_PROTOCOLS.has(url.protocol)) return null;

  // `URL` lowercases the scheme and host and punycodes IDN, but leaves a trailing dot.
  const host = url.hostname.replace(/\.$/, "");
  if (host === "") return null;
  // Empty labels (`https://..`, `https://.com`). An IPv6 literal is one bracketed label
  // and passes through untouched.
  if (!host.startsWith("[") && host.split(".").some((label) => label === "")) {
    return null;
  }
  url.hostname = host;

  // Drop the password. A bookmark is persisted in cleartext and rendered in the sidebar,
  // so keeping `https://alice:hunter2@host/x` would write a secret to disk the user never
  // asked us to store, and then show it to whoever is looking at the screen. The username
  // stays: it is part of the destination, not a credential.
  url.password = "";

  // Re-serialize via `href` rather than rebuilding by hand: it drops the default port, and
  // keeps the path, the query (order and duplicates intact), and the fragment exactly as
  // they were. Everything we want to preserve is preserved by NOT touching it.
  return url.href;
}
