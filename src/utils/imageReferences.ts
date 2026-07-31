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
 * @coordinates-with services/media/orphanAssetCleanup.ts — sole consumer
 * @module utils/imageReferences
 */

/**
 * An `<img …>` tag, captured whole so its attributes can be scanned in turn.
 * Quote-aware: `[^>]*` would end the tag at a `>` INSIDE an attribute value
 * (`<img alt="a > b" src="x.png">`), truncating it before the src and losing
 * the reference entirely — which marks a displayed image for deletion.
 */
const IMG_TAG_RE = /<img\s(?:"[^"]*"|'[^']*'|[^>])*>/gi;

/**
 * A source attribute inside one tag. Tolerates whitespace around `=`, either
 * quote style, and an unquoted value — all of which browsers render and a
 * stricter pattern would silently treat as "no reference". `data-src` counts
 * too: lazy-loading markup points at a real file, and protecting it costs a
 * stray set entry whereas missing it costs the file. The lookbehind keeps
 * `fallbacksrc` and `x:src` out.
 */
const IMG_SRC_ATTR_RE =
  /(?<![\w:-])(?:data-)?src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * Link reference definition: `[label]: path "title"`, up to three spaces of
 * indent. Harvested unconditionally — `![alt][label]`, `![label][]` and
 * `![label]` all resolve through one of these, and telling an image definition
 * from a link definition requires resolving the whole document. A link target
 * that happens to sit in the assets folder is worth protecting anyway.
 */
const REF_DEFINITION_RE =
  /^[ ]{0,3}\[(?:\\.|[^\]\n])+\]:[ \t]*(?:<([^>\n]+)>|(\S+))[ \t]*(?:["'(].*)?$/gm;

/**
 * Index of the delimiter closing the one opened at `open`, honouring nesting
 * and backslash escapes. -1 if it never closes before `limit`.
 *
 * The bound matters: an unterminated `![alt](` would otherwise scan the whole
 * rest of the document and latch onto any stray `)` in prose — a smiley is
 * enough. Everything between then looks like one giant destination, and every
 * real image inside it is skipped, which is a deletion candidate each.
 */
function matchDelimiter(
  text: string,
  open: number,
  openCh: string,
  closeCh: string,
  limit: number = text.length
): number {
  let depth = 0;
  for (let i = open; i < limit; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++; // skip the escaped character
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh && --depth === 0) return i;
  }
  return -1;
}

/**
 * End of the block starting at `from`: the next blank line, or end of input.
 * Neither an image's alt text nor its destination may span one (CommonMark),
 * so this is the furthest a single image construct can legally reach.
 */
function blockEnd(text: string, from: number): number {
  const blank = text.indexOf("\n\n", from);
  return blank === -1 ? text.length : blank;
}

/**
 * The destination inside a `(...)` span: `<path with spaces>`, or everything up
 * to the whitespace that starts an optional title. CommonMark requires angle
 * brackets for a destination containing spaces, so the split is unambiguous.
 */
function destinationOf(inner: string): string {
  const trimmed = inner.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  const ws = trimmed.search(/\s/);
  return ws === -1 ? trimmed : trimmed.slice(0, ws);
}

/**
 * Scan inline images `![alt](destination)`.
 *
 * Hand-scanned rather than matched by regex because both halves nest: alt text
 * legitimately contains `[brackets]` and a destination legitimately contains
 * balanced `(parens)` — `screenshot_(1).png` is an ordinary filename. A regex
 * that stops at the first `]` or `)` reports NO reference for those, and a
 * reference this parser cannot see is a file that gets deleted.
 */
function scanInlineImages(content: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < content.length - 1; i++) {
    if (content[i] !== "!" || content[i + 1] !== "[") continue;
    // Only an ODD run of preceding backslashes escapes the marker: `\\![a](x)`
    // is an escaped backslash followed by a REAL image. Treating it as escaped
    // loses the reference — and a lost reference is a deleted file.
    let slashes = 0;
    while (i - 1 - slashes >= 0 && content[i - 1 - slashes] === "\\") slashes++;
    if (slashes % 2 === 1) continue;

    const limit = blockEnd(content, i);
    const altEnd = matchDelimiter(content, i + 1, "[", "]", limit);
    if (altEnd === -1) continue;
    // `![alt][ref]` and `![ref]` resolve through a definition line instead.
    if (content[altEnd + 1] !== "(") {
      i = altEnd;
      continue;
    }

    const destEnd = matchDelimiter(content, altEnd + 1, "(", ")", limit);
    if (destEnd === -1) continue;

    const destination = destinationOf(content.slice(altEnd + 2, destEnd));
    if (destination) found.push(destination);
    i = destEnd;
  }
  return found;
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
  let path = raw.replace(/\\([!-/:-@[-`{-~])/g, "$1").replace(/\\/g, "/");
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
  let path = raw.replace(/\\([!-/:-@[-`{-~])/g, "$1").replace(/\\/g, "/");
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

/** Every image destination in `content`, exactly as written. */
function collectRawReferences(content: string): string[] {
  const raw: string[] = [];

  /** Add the first non-empty capture group among `groups` for every match. */
  const collect = (re: RegExp, ...groups: number[]) => {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const found = groups.map((g) => match![g]).find(Boolean);
      if (found) raw.push(found);
    }
  };

  raw.push(...scanInlineImages(content));

  // Two stages: isolate each tag, then take EVERY source attribute inside it.
  IMG_TAG_RE.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = IMG_TAG_RE.exec(content)) !== null) {
    IMG_SRC_ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = IMG_SRC_ATTR_RE.exec(tag[0])) !== null) {
      const src = attr[1] || attr[2] || attr[3];
      if (src) raw.push(src);
    }
  }

  collect(REF_DEFINITION_RE, 1, 2);

  return raw;
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
