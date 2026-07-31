/**
 * Image Reference Scanner (Pure)
 *
 * Purpose: find every image destination in a document, exactly as written.
 * Normalizing and comparing them is imageReferences.ts's job; this module only
 * answers "where does the document point?".
 *
 * Hand-scanned rather than regex-matched, because the constructs nest and a
 * miss here is destructive: orphan cleanup deletes files this scanner does not
 * report. Alt text may contain brackets and code spans, destinations may
 * contain balanced parens or sit inside angle brackets, and titles may contain
 * either — a regex that stops at the first `]` or `)` reports NO reference for
 * any of those, and the file is then removed while the document still shows it.
 *
 * @coordinates-with imageReferences.ts — sole consumer
 * @module utils/imageReferenceScanner
 */

/**
 * An `<img …>` / `<source …>` tag, captured whole so its attributes can be
 * scanned in turn. Quote-aware: `[^>]*` would end the tag at a `>` INSIDE an
 * attribute value (`<img alt="a > b" src="x.png">`), truncating it before the
 * src and losing the reference entirely — which marks a displayed image for
 * deletion.
 */
const IMG_TAG_RE = /<(?:img|source)\s(?:"[^"]*"|'[^']*'|[^>])*>/gi;

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
 * A `srcset` candidate list: `url 2x, url2 640w`. Every candidate is a real file
 * the browser may choose to display, so every one is worth protecting. A
 * responsive `<img srcset>` or `<picture><source srcset>` can carry the only
 * reference to an image, and missing it deletes a picture that renders.
 */
const SRCSET_ATTR_RE =
  /(?<![\w:-])(?:data-)?srcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * Link reference definition: `[label]: path "title"`, up to three spaces of
 * indent. Harvested unconditionally — `![alt][label]`, `![label][]` and
 * `![label]` all resolve through one of these, and telling an image definition
 * from a link definition requires resolving the whole document. A link target
 * that happens to sit in the assets folder is worth protecting anyway.
 */
const REF_DEFINITION_RE =
  /^[ ]{0,3}\[(?:\\.|[^\]\n])+\]:[ \t]*(?:\r?\n[ \t]*)?(?:<([^>\n]+)>|(\S+))[ \t]*(?:["'(].*)?$/gm;

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
    // A code span is literal: `![a `]` ](x.png)` is a valid image whose alt text
    // merely CONTAINS a bracket. Ending the alt there loses the reference.
    if (ch === "`") {
      const close = skipCodeSpan(text, i, limit);
      if (close !== -1) {
        i = close;
        continue;
      }
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh && --depth === 0) return i;
  }
  return -1;
}

/**
 * Index of the last backtick closing the code span opened at `open`, or -1 when
 * it never closes. A span is closed by a backtick run of the SAME length.
 */
function skipCodeSpan(text: string, open: number, limit: number): number {
  let runEnd = open;
  while (runEnd < limit && text[runEnd] === "`") runEnd++;
  const run = text.slice(open, runEnd);
  const close = text.indexOf(run, runEnd);
  if (close === -1 || close >= limit) return -1;
  // Reject a longer run — it is not this span's terminator.
  return text[close + run.length] === "`" ? -1 : close + run.length - 1;
}

/**
 * End of the block starting at `from`: the next blank line, or end of input.
 * Neither an image's alt text nor its destination may span one (CommonMark),
 * so this is the furthest a single image construct can legally reach.
 */
function blockEnd(text: string, from: number): number {
  // CRLF files and whitespace-only "blank" lines are blank lines too. Matching
  // only "\n\n" let a malformed image run past one and swallow the next image.
  BLANK_LINE_RE.lastIndex = from;
  const m = BLANK_LINE_RE.exec(text);
  return m ? m.index : text.length;
}

/** A CommonMark blank line: a newline, optional spaces/tabs, another newline. */
const BLANK_LINE_RE = /\r?\n[ \t]*\r?\n/g;

/**
 * Index of the `)` closing the destination span opened at `open`.
 *
 * Not plain paren counting: a `(` inside an angle-bracket destination
 * (`<foo(1.png>`) or inside a quoted title (`"title ("`) is literal, and
 * counting it as nesting makes the span never close — losing the reference,
 * which puts the file up for deletion.
 */
function matchDestination(text: string, open: number, limit: number): number {
  let depth = 0;
  for (let i = open; i < limit; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "<") {
      const close = text.indexOf(">", i + 1);
      if (close !== -1 && close < limit) {
        i = close;
        continue;
      }
    }
    if (ch === '"' || ch === "'") {
      const close = text.indexOf(ch, i + 1);
      if (close !== -1 && close < limit) {
        i = close;
        continue;
      }
    }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
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

    const destEnd = matchDestination(content, altEnd + 1, limit);
    if (destEnd === -1) continue;

    const destination = destinationOf(content.slice(altEnd + 2, destEnd));
    if (destination) found.push(destination);
    i = destEnd;
  }
  return found;
}

/** Every image destination in `content`, exactly as written. */
export function collectRawReferences(content: string): string[] {
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
    SRCSET_ATTR_RE.lastIndex = 0;
    let srcset: RegExpExecArray | null;
    while ((srcset = SRCSET_ATTR_RE.exec(tag[0])) !== null) {
      const list = srcset[1] || srcset[2] || srcset[3];
      if (!list) continue;
      // "a.png 2x, b.png 640w" — the URL is the leading token of each candidate.
      for (const candidate of list.split(",")) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) raw.push(url);
      }
    }
  }

  collect(REF_DEFINITION_RE, 1, 2);

  return raw;
}
