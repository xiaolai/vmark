/**
 * One masking model for every source-scanning lint rule.
 *
 * Purpose: E01, E04, E05 and W03 all answer the same question before they
 * scan a line — "is this text the parser reads as prose?" — and each carried
 * its own half-answer. Measured on adoption (audit 20260907 round 3), the
 * three models disagreed about one document at eight places:
 *
 *   - a fence a container prefixes (`> ``` `) was invisible to every
 *     line-anchored fence tracker, so E01 and E05 scanned code as prose;
 *   - a double-backtick or multi-LINE code span was invisible to the
 *     ``/`[^`]*`/g`` strip E01 and W03 used, so both reported references
 *     written inside one;
 *   - YAML front matter and raw HTML blocks were scanned by E04 and E01,
 *     which is how `#comment:` in front matter became a heading diagnostic.
 *
 * The model here is two layers, applied in this order and for this reason:
 * BLOCK first (from the parser's own node positions — the only thing that
 * knows about containers), then INLINE code spans over what is left. Doing it
 * the other way lets a fence line's own ``` open a span and swallow the rest
 * of the document.
 *
 * Masking replaces characters with SPACES rather than deleting them, so a
 * scanner's `match.index` is still the column it was, and `lineOffsets` still
 * locates it in the source. Newlines survive for the same reason.
 *
 * @coordinates-with src/lib/lintEngine/rules/referenceScanner.ts — the reference rules' shared half
 * @module lib/lintEngine/rules/sourceMask
 */

import { visit } from "unist-util-visit";
import type { Code, Html, Root, Yaml } from "mdast";

/** Node types whose `html` children are BLOCKS rather than inline markup. */
const FLOW_PARENTS: ReadonlySet<string> = new Set([
  "root",
  "blockquote",
  "listItem",
  "footnoteDefinition",
]);

/** Add every 1-based line `position` spans to `into`. */
function occupiedLines(position: Code["position"], into: Set<number>): void {
  if (!position) return;
  for (let line = position.start.line; line <= position.end.line; line++) into.add(line);
}

/**
 * Every 1-based line the parser does NOT read as markdown prose: fenced and
 * indented code, front matter, and raw HTML BLOCKS.
 *
 * Only flow-level `html` counts. `html` is both a block and an inline node in
 * mdast, and masking the line of an inline `<b>` would take a real `[ref]`
 * beside it with it — the opposite mistake, and a louder one.
 */
export function unparsedLines(mdast: Root): Set<number> {
  const lines = new Set<number>();
  visit(mdast, "code", (node: Code) => occupiedLines(node.position, lines));
  visit(mdast, "yaml", (node: Yaml) => occupiedLines(node.position, lines));
  visit(mdast, "html", (node: Html, _index, parent) => {
    if (parent && FLOW_PARENTS.has(parent.type)) occupiedLines(node.position, lines);
  });
  return lines;
}

/**
 * Blank the CONTENT of every inline code span in `text`, keeping its length.
 *
 * CommonMark backtick-run matching: a span opens on a run of N backticks and
 * closes at the next run of exactly N — a run of a different length is span
 * content. A backslash outside a span escapes the next character; inside one
 * there are no escapes.
 *
 * The search for a closing run stops at a BLANK LINE. A code span is an INLINE
 * construct, so it cannot cross a paragraph boundary, and without that bound a
 * single stray backtick would mask everything after it — turning one typo into
 * a silently disabled linter for the rest of the file.
 */
export function maskCodeSpans(text: string): string {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "`") {
      i += 1;
      continue;
    }
    let openLen = 1;
    while (text[i + openLen] === "`") openLen += 1;
    const limit = paragraphEnd(text, i + openLen);
    let j = i + openLen;
    let closeStart = -1;
    while (j < limit) {
      if (text[j] !== "`") {
        j += 1;
        continue;
      }
      let runLen = 1;
      while (text[j + runLen] === "`") runLen += 1;
      if (runLen === openLen) {
        closeStart = j;
        break;
      }
      j += runLen;
    }
    if (closeStart === -1) {
      i += openLen; // unmatched run is literal text; keep scanning after it
      continue;
    }
    const end = closeStart + openLen;
    for (let k = i; k < end; k++) if (out[k] !== "\n") out[k] = " ";
    i = end;
  }
  return out.join("");
}

/** Offset of the first blank line at or after `from`, or the text's end. */
function paragraphEnd(text: string, from: number): number {
  const blank = text.indexOf("\n\n", from);
  return blank === -1 ? text.length : blank;
}

/**
 * `lines` with every non-prose region blanked — block first, then spans.
 *
 * Every returned line has the same LENGTH as the line it replaces, so a rule
 * scanning the masked text reports the columns and offsets of the real one.
 */
export function maskedLines(lines: readonly string[], mdast: Root): string[] {
  const blocks = unparsedLines(mdast);
  const blanked = lines.map((line, i) => (blocks.has(i + 1) ? " ".repeat(line.length) : line));
  return maskCodeSpans(blanked.join("\n")).split("\n");
}
