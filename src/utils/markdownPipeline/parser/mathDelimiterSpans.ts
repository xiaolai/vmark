/**
 * Purpose: Recognize ChatGPT-style `\[ … \]` / `\( … \)` LaTeX
 * delimiter spans in raw markdown, and normalize them to the
 * `$`-delimiters remark-math understands (issue #1180). Runs before
 * remark because CommonMark escape handling consumes the backslashes
 * into literal brackets — no mdast transform can see them.
 *
 * Key decisions:
 *   - Worst-case linear: escape parity, blank-line boundaries, closer
 *     positions, and a mask prefix-sum are each precomputed in one
 *     pass; the opener loop then advances monotonic pointers, so a
 *     flood of unpaired openers — even with masked or escaped closers
 *     in range — never rescans (Codex M5/M6).
 *   - Spans never overlap opaque regions — code, HTML (every
 *     CommonMark block class and inline tags), frontmatter, reference
 *     definitions, link/image destinations and autolinks — derived
 *     from a probe parse (mathProbe.ts), so micromark's grammar is the
 *     authority, not a regex approximation. (Existing math is NOT
 *     opaque — see mathProbe's OPAQUE_TYPES for why.) Spans never cross a blank
 *     line, and display spans convert only when standalone:
 *     mid-sentence `\[…\]` is escaped-bracket prose (the corpus has
 *     `\[not a link\]`), while ChatGPT emits display math on its own
 *     lines. Inline `\(…\)` has no prose collision and converts even
 *     with CJK butted against it — no whitespace requirement.
 *   - Replacement delimiters follow mdast-util-math's sizing: the
 *     dollar run must exceed the longest run in the content, so
 *     `\( \text{\$5} \)` becomes `$$\text{\$5}$$`, not `$…$` truncated
 *     at the inner dollar (Codex H4).
 *   - The span finder is shared with cleanPastedMarkdown, which must
 *     NOT strip the backslashes of a recognized math pair on paste.
 *
 * @coordinates-with ./mathProbe.ts — the hands-off mask
 * @coordinates-with ./mathSourceGuards.ts — re-exports normalize for parser.ts
 * @coordinates-with @/utils/cleanPastedMarkdown — protects spans on paste
 * @module utils/markdownPipeline/parser/mathDelimiterSpans
 */

import { buildProbeOpaqueMask } from "./mathProbe";

export interface MathDelimiterSpan {
  /** Offset of the opener's backslash. */
  start: number;
  /** Offset just past the closer's bracket. */
  end: number;
  /** Trimmed LaTeX content between the delimiters. */
  content: string;
  kind: "display" | "inline";
}

const KINDS = [
  { open: "\\[", closeChar: "]", kind: "display" as const },
  { open: "\\(", closeChar: ")", kind: "inline" as const },
];

/** escapedAt[i] = 1 when the char at i is preceded by an ODD number of
 *  backslashes (i.e. it is itself escaped). One pass. */
function buildEscapedAt(text: string): Uint8Array {
  const escapedAt = new Uint8Array(text.length);
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (run % 2 === 1) escapedAt[i] = 1;
    run = text[i] === "\\" ? run + 1 : 0;
  }
  return escapedAt;
}

/** prefix[i] = number of masked bytes in text[0, i). */
function buildMaskPrefix(mask: Uint8Array): Int32Array {
  const prefix = new Int32Array(mask.length + 1);
  for (let i = 0; i < mask.length; i++) prefix[i + 1] = prefix[i] + mask[i];
  return prefix;
}

const BLANK_LINE = /^[ \t]*\r?$/;
const WHITESPACE_ONLY = /^[ \t]*$/;
const WHITESPACE_EOL = /^[ \t]*\r?$/;

/** Offsets of each `\n` that immediately precedes a blank line. */
function buildBlankBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    if (lineStart > 0 && BLANK_LINE.test(text.slice(lineStart, lineEnd))) {
      boundaries.push(lineStart - 1);
    }
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  return boundaries;
}

/** Longest run of consecutive `$` anywhere in `content`. */
function longestDollarRun(content: string): number {
  let longest = 0;
  let run = 0;
  for (const c of content) {
    run = c === "$" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}

/** Longest `$`-run forming a whole (closer-shaped) line of `content`. */
function longestDollarOnlyLine(content: string): number {
  let longest = 0;
  for (const line of content.split("\n")) {
    const m = /^ {0,3}(\$+)[ \t]*\r?$/.exec(line);
    if (m && m[1].length > longest) longest = m[1].length;
  }
  return longest;
}

/** All convertible math delimiter spans in `text`, sorted by start. */
export function findMathDelimiterSpans(
  text: string,
  mask: Uint8Array = buildProbeOpaqueMask(text),
): MathDelimiterSpan[] {
  const spans: MathDelimiterSpan[] = [];
  const escapedAt = buildEscapedAt(text);
  const maskPrefix = buildMaskPrefix(mask);
  const blanks = buildBlankBoundaries(text);
  const maskedBetween = (from: number, to: number): boolean =>
    maskPrefix[to] - maskPrefix[from] > 0;

  for (const { open, closeChar, kind } of KINDS) {
    // Usable closer positions, precomputed once.
    const closers: number[] = [];
    for (let j = text.indexOf("\\" + closeChar); j !== -1; j = text.indexOf("\\" + closeChar, j + 1)) {
      if (escapedAt[j] !== 1 && mask[j] !== 1 && mask[j + 1] !== 1) {
        closers.push(j);
      }
    }
    if (closers.length === 0) continue;

    let cIdx = 0;
    let bIdx = 0;
    let pos = 0;
    for (;;) {
      const i = text.indexOf(open, pos);
      if (i === -1) break;
      pos = i + 2;
      if (mask[i] === 1 || mask[i + 1] === 1 || escapedAt[i] === 1) continue;

      while (cIdx < closers.length && closers[cIdx] < i + 2) cIdx += 1;
      if (cIdx === closers.length) break; // no closer remains for ANY later opener
      const closer = closers[cIdx];
      while (bIdx < blanks.length && blanks[bIdx] <= i) bIdx += 1;
      const blank = bIdx < blanks.length ? blanks[bIdx] : Number.POSITIVE_INFINITY;
      if (blank < closer) continue; // dead opener — blank line first
      const end = closer + 2;
      if (maskedBetween(i, end)) continue; // spans an opaque region

      const content = text.slice(i + 2, closer).trim();
      if (content.length === 0) continue;

      if (kind === "display") {
        const lineStart = text.lastIndexOf("\n", i - 1) + 1;
        const nl = text.indexOf("\n", end);
        const lineEnd = nl === -1 ? text.length : nl;
        const standalone =
          WHITESPACE_ONLY.test(text.slice(lineStart, i)) &&
          WHITESPACE_EOL.test(text.slice(end, lineEnd));
        if (!standalone) continue;
      }

      spans.push({ start: i, end, content, kind });
      pos = end;
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Rewrite recognized delimiter spans to `$`-form. Overlapping spans
 * (a display span wrapping an inline pair) resolve outer-first.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes("\\[") && !markdown.includes("\\(")) return markdown;
  const spans = findMathDelimiterSpans(markdown);
  if (spans.length === 0) return markdown;

  const pieces: string[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.start < last) continue; // nested inside a consumed span
    let rendered: string;
    if (span.kind === "display") {
      const fence = "$".repeat(
        Math.max(2, longestDollarOnlyLine(span.content) + 1),
      );
      rendered = `${fence}\n${span.content}\n${fence}`;
    } else {
      const run = "$".repeat(
        Math.max(1, longestDollarRun(span.content) + 1),
      );
      rendered = `${run}${span.content}${run}`;
    }
    pieces.push(markdown.slice(last, span.start), rendered);
    last = span.end;
  }
  pieces.push(markdown.slice(last));
  return pieces.join("");
}
