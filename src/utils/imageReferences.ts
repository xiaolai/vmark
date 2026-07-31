/**
 * Image Reference Extraction (Pure)
 *
 * Purpose: Collect every image path a document references, normalized so it can
 * be compared against filenames on disk.
 *
 * This parser decides which files orphan cleanup DELETES. A reference it fails
 * to see is a file the user still displays and we remove — so every rule here
 * errs toward over-collecting. Link reference definitions are harvested whether
 * or not an image actually uses them, and a path that fails to decode is kept
 * verbatim rather than dropped.
 *
 * Key decisions:
 *   - Comparison is case-insensitive (`referenceKey`). macOS is case-insensitive
 *     by default, so `Photo.png` in the document really does display
 *     `photo.png` on disk; matching case-sensitively would call it an orphan.
 *   - `?query` and `#fragment` are stripped — they address the reference, not
 *     the file.
 *   - Backslash separators are normalized: a document authored on Windows can
 *     carry `assets\images\x.png`.
 *
 * @coordinates-with imageReferenceScanner.ts — finds the raw destinations
 * @coordinates-with services/media/orphanAssetCleanup.ts — sole consumer
 * @module utils/imageReferences
 */

import { collectRawReferences } from "./imageReferenceScanner";

/**
 * Resolve the CommonMark character references a renderer resolves, so the key
 * matches the file on disk: `a&amp;b.png` displays the file `a&b.png`.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

function decodeCharacterReferences(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

/**
 * Clean one raw reference into a comparable path: strip a leading `./`, drop
 * any `?query`/`#fragment`, normalize `\` to `/`, and percent-decode.
 * Case is preserved — use `referenceKey` to compare.
 */
export function normalizeImageReference(raw: string): string {
  // Order matters: a backslash before ASCII punctuation is a markdown ESCAPE
  // (`image\(1\).png`), while a backslash before anything else is a Windows
  // path separator (`assets\images\x.png`). Unescape first, fold second —
  // reversed, an escaped paren turns into a bogus directory boundary.
  let path = decodeCharacterReferences(raw)
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/\\/g, "/");
  // Order matters: `#` can legally appear in a percent-encoded filename, so cut
  // the fragment before decoding, not after.
  const hash = path.indexOf("#");
  if (hash !== -1) path = path.slice(0, hash);
  const query = path.indexOf("?");
  if (query !== -1) path = path.slice(0, query);
  while (path.startsWith("./")) path = path.slice(2);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed percent-encoding — keep the raw form. Dropping it would make
    // the file it points at look unreferenced.
  }
  return path;
}

/**
 * Normalize WITHOUT dropping `?`/`#`. Both characters are legal in a filename,
 * so the stripping that makes `photo.png?v=2` match `photo.png` also truncates
 * a file genuinely called `a#b.png` down to `a` — which then matches nothing
 * and is deleted. Keeping both spellings costs one extra set entry; keeping
 * only the stripped one costs the file.
 */
function normalizeKeepingSuffix(raw: string): string {
  let path = decodeCharacterReferences(raw)
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/\\/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed percent-encoding — keep the raw form.
  }
  return path;
}

/**
 * The key two references are compared by. Case-folded: see the header for why
 * a case-sensitive match deletes live files on macOS.
 */
export function referenceKey(path: string): string {
  return normalizeImageReference(path).toLowerCase();
}

/**
 * The key an on-disk FILENAME is compared by. Never strips `?`/`#`, because in
 * a filename those are data, not a query or fragment.
 */
export function assetKey(path: string): string {
  return normalizeKeepingSuffix(path).toLowerCase();
}

/**
 * Extract every image reference in `content`, normalized.
 * Includes external URLs (harmless — they never match a local filename) and
 * every link reference definition.
 */
export function extractImageReferences(content: string): Set<string> {
  const refs = new Set<string>();
  for (const raw of collectRawReferences(content)) refs.add(normalizeImageReference(raw));
  return refs;
}

/**
 * Build the comparison set for `content` in one pass.
 *
 * Each reference contributes BOTH spellings — with and without a trailing
 * `?query`/`#fragment` — so a cache-busted `photo.png?v=2` matches the file
 * `photo.png`, AND a file genuinely named `a#b.png` matches its reference.
 * Over-collecting only ever protects a file; under-collecting deletes one.
 */
export function extractImageReferenceKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const raw of collectRawReferences(content)) {
    keys.add(referenceKey(raw));
    keys.add(assetKey(raw));
  }
  return keys;
}
