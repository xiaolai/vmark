/**
 * Marker pairing rules for VMark's custom inline marks.
 *
 * Purpose: decides WHERE a `==highlight==` / `++underline++` / `^superscript^`
 * / `~subscript~` span begins and ends. Split out of customInlineTransform.ts
 * so that file stays under the size limit; it owns walking the tree and
 * building nodes, this owns the question "is this pair of markers a pair".
 *
 * Key decisions:
 *   - The SINGLE-character marks (`^`, `~`) refuse a span containing unescaped
 *     whitespace, which is Pandoc's rule. Without it two numeric ranges in one
 *     paragraph paired with each other and subscripted everything between them
 *     (#1280). `\ ` is Pandoc's deliberate space and survives as content.
 *   - A rejected candidate advances to the next CLOSING marker rather than
 *     abandoning the opening, so `range 4~6 then H~2~O` still finds `~2~`.
 *   - The two-character marks are exempt: `==a highlighted phrase==` spanning
 *     words is their normal use.
 *
 * @coordinates-with customInlineTransform.ts — the only consumer
 * @module utils/markdownPipeline/plugins/markPairing
 */

export interface MarkDefinition {
  readonly name: "highlight" | "underline" | "superscript" | "subscript";
  readonly marker: string;
  readonly markerLen: number;
  readonly skipDouble?: boolean;
  /**
   * Pandoc's rule for the single-character marks: a `~sub~` / `^sup^` span may
   * not contain unescaped whitespace. Without it the two `~` in
   * `4~6 files, including 1~2 cases` pair with each other and subscript
   * everything between them (#1280) — and `2^nd … 3^rd` does the same. The
   * two-character marks are deliberately exempt: `==a highlighted phrase==`
   * spanning words is their normal use.
   */
  readonly noUnescapedWhitespace?: boolean;
}


export const MARKS: readonly MarkDefinition[] = [
  { name: "highlight", marker: "==", markerLen: 2 },
  { name: "underline", marker: "++", markerLen: 2 },
  { name: "superscript", marker: "^", markerLen: 1, noUnescapedWhitespace: true },
  { name: "subscript", marker: "~", markerLen: 1, skipDouble: true, noUnescapedWhitespace: true },
];

/**
 * Does `span` contain whitespace that is not backslash-escaped? An odd run of
 * backslashes escapes the character after it, so `a\ b` is a deliberate
 * subscript space (Pandoc's spelling) while `a\\ b` is a literal backslash
 * followed by a real space.
 */
function hasUnescapedWhitespace(span: string): boolean {
  for (let i = 0; i < span.length; i++) {
    if (!/\s/.test(span[i])) continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && span[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 0) return true;
  }
  return false;
}

/** Drop the backslash from `\<whitespace>` so the mark's text reads naturally. */
export function unescapeWhitespace(span: string): string {
  return span.replace(/\\(\s)/g, "$1");
}

/** Is this a valid span for `mark`, per its whitespace rule? */
export function spanIsPairable(span: string, mark: MarkDefinition): boolean {
  return !mark.noUnescapedWhitespace || !hasUnescapedWhitespace(span);
}

/** Index of the first usable marker in `text`, respecting `skipDouble`, or -1. */
export function findMarkerIn(text: string, mark: MarkDefinition, from: number): number {
  let at = from;
  while (at < text.length) {
    const found = text.indexOf(mark.marker, at);
    if (found === -1) return -1;
    if (mark.skipDouble && mark.markerLen === 1 && text[found + 1] === mark.marker) {
      at = found + 2;
      continue;
    }
    return found;
  }
  return -1;
}

export function findMarkPair(
  text: string,
  mark: MarkDefinition,
  fromIndex: number
): { start: number; end: number } | null {
  let startIdx = fromIndex;

  while (startIdx < text.length) {
    const foundStart = text.indexOf(mark.marker, startIdx);
    if (foundStart === -1) return null;

    // Skip if this is a double marker when skipDouble is set
    if (mark.skipDouble && mark.markerLen === 1 && text[foundStart + 1] === mark.marker) {
      startIdx = foundStart + 2;
      continue;
    }

    // Find closing marker
    let searchPos = foundStart + mark.markerLen;
    while (searchPos < text.length) {
      const closeIdx = text.indexOf(mark.marker, searchPos);
      if (closeIdx === -1) break;

      // Skip double markers when configured
      if (mark.skipDouble && mark.markerLen === 1 && text[closeIdx + 1] === mark.marker) {
        searchPos = closeIdx + 2;
        continue;
      }

      // Valid closing marker found
      if (closeIdx > foundStart + mark.markerLen) {
        // A span carrying unescaped whitespace is not a pair. Keep scanning:
        // in `range 4~6 then H~2~O` the first two candidate closes are
        // rejected, and the real `~2~` is still found on a later opening.
        if (!spanIsPairable(text.slice(foundStart + mark.markerLen, closeIdx), mark)) {
          searchPos = closeIdx + mark.markerLen;
          continue;
        }
        return { start: foundStart, end: closeIdx };
      }
      break;
    }

    // No valid closing marker, try next occurrence
    startIdx = foundStart + 1;
  }

  return null;
}
