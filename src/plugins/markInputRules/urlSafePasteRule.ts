/**
 * URL-aware mark paste rules.
 *
 * Pasted URLs frequently contain characters that emphasis paste rules would
 * otherwise match — `__init__.py` (Python), `_drafts_/post` (Jekyll), or
 * snake_case query parameters. The regex-level intraword guard already
 * rejects `_word_` flanked by word characters on both sides; this layer
 * catches the rest, where one or both boundary characters are non-word
 * path delimiters (`/`, `.`, `?`, `=`, `&`).
 *
 * Both layers are kept: the regex change is CommonMark-correct on its own
 * (intraword `_` never emphasizes per the spec), and the URL filter is a
 * second, independent guarantee that no emphasis mark is ever applied
 * inside a URL substring.
 *
 * @coordinates-with markInputRules/tiptap.ts — CJKBold / CJKItalic consume urlSafeMarkPasteRule
 * @module plugins/markInputRules/urlSafePasteRule
 */

import { markPasteRule, type PasteRule, type PasteRuleMatch } from "@tiptap/core";
import type { MarkType } from "@tiptap/pm/model";

/**
 * Scheme-prefixed URLs (`https://…`, `file://…`, `ftp://…`) plus the common
 * `www.` bare-host shape. The character class stops at the practical plain-
 * text URL boundary (whitespace and bracket/quote delimiters). Trailing
 * sentence punctuation may be included in the matched range, which is fine
 * for our purpose — we use the range only to *exclude* emphasis matches.
 */
const URL_PATTERN = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'`]+/gi;

/** A half-open character range in a pasted text buffer. */
export interface UrlRange {
  start: number;
  /** Exclusive end index. */
  end: number;
}

/** Locate URL substrings in a pasted text buffer. */
export function findUrlRanges(text: string): UrlRange[] {
  const ranges: UrlRange[] = [];
  const re = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
    /* v8 ignore next -- @preserve URL_PATTERN cannot produce a zero-width match (`scheme://[^\s…]+` requires ≥1 trailing char); guard is defensive against pattern edits. */
    if (m[0].length === 0) re.lastIndex++;
  }
  return ranges;
}

/**
 * True iff `[start, end)` intersects any of the supplied URL ranges.
 * `urls` MUST be sorted by `start` ascending — `findUrlRanges` produces
 * them in order, and matches arrive in order too, so a moving cursor
 * reduces per-call work from O(matches × urls) to O(matches + urls).
 */
function overlapsAnyUrl(
  start: number,
  end: number,
  urls: readonly UrlRange[],
  cursor: { i: number },
): boolean {
  // Advance past URL ranges that end at or before this match starts —
  // they can't overlap this or any later (rightward) match.
  while (cursor.i < urls.length && urls[cursor.i].end <= start) {
    cursor.i++;
  }
  if (cursor.i >= urls.length) return false;
  // The next-in-order URL range may or may not overlap; check its left edge.
  return urls[cursor.i].start < end;
}

/**
 * Run `pattern` against `text` and return matches whose ranges do NOT overlap
 * any URL substring. The caller's regex object is not mutated — a fresh
 * `RegExp` is constructed from its `source`/`flags`, so global `lastIndex`
 * state can't leak across calls. The `g` flag is forced because `exec`
 * without it would loop forever on the same match.
 */
export function findMatchesOutsideUrls(
  text: string,
  pattern: RegExp,
): RegExpExecArray[] {
  const urls = findUrlRanges(text);
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  const out: RegExpExecArray[] = [];
  // Matches arrive left-to-right; URL ranges are likewise sorted. A single
  // cursor amortizes the overlap check to O(matches + urls).
  const urlCursor = { i: 0 };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    /* v8 ignore next 4 -- @preserve emphasis patterns we ship require ≥1 inner char; guard is defensive against future callers passing a pattern that can match zero-width. */
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    if (overlapsAnyUrl(start, end, urls, urlCursor)) continue;
    out.push(m);
  }
  return out;
}

/**
 * Build the finder function Tiptap's paste-rule pipeline expects: returns
 * the URL-safe subset of matches, or `null` when none survive. Exposed for
 * direct unit testing — production callers should use `urlSafeMarkPasteRule`.
 */
export function buildUrlSafeFinder(
  pattern: RegExp,
): (text: string) => PasteRuleMatch[] | null {
  return (text: string) => {
    const matches = findMatchesOutsideUrls(text, pattern);
    if (matches.length === 0) return null;
    return matches.map<PasteRuleMatch>((m) => ({
      index: m.index,
      text: m[0],
      match: m,
    }));
  };
}

/**
 * Drop-in replacement for `markPasteRule` that skips matches inside URLs.
 * The `find` regex is wrapped in a finder function so Tiptap sees only the
 * URL-safe subset of matches.
 */
export function urlSafeMarkPasteRule({
  find,
  type,
}: {
  find: RegExp;
  type: MarkType;
}): PasteRule {
  return markPasteRule({
    find: buildUrlSafeFinder(find),
    type,
  });
}
