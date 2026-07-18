/**
 * Clean Pasted Markdown
 *
 * Cleans up markdown text pasted from AI assistants (Gemini, ChatGPT, Claude)
 * into source mode by stripping unnecessary backslash escapes (e.g., \| \# \*
 * mid-line).
 *
 * Raw <br> tags are deliberately left untouched: inside GFM table cells a
 * <br> is the only valid way to represent a line break (cells cannot contain
 * literal newlines), so converting it to "\n" would structurally break the
 * table.
 */

import { buildCodeMask } from "./markdownCodeMask";

/** Characters that are safe to unescape when they appear mid-line. */
const SAFE_MID_LINE = "#\\-*_`|[\\]()>+.!";

/** Characters that create block-level syntax at start of line — keep escaped there. */
const BLOCK_TRIGGERS = "#-*>+";

/** Regex matching a backslash before any character in the safe set. */
const ESCAPE_RE = new RegExp(`\\\\([${SAFE_MID_LINE}])`, "g");

/**
 * True when unescaping `char` (the character following the backslash at
 * `offset`, where `offset` is the backslash's index in `markdown`) would
 * create block-level syntax: a heading/list/blockquote trigger at the
 * start of a line, or an ordered-list marker (`1\.` / `1\)`) after
 * leading digits.
 *
 * Shared with htmlToMarkdown's post-processing pass so both unescape
 * passes preserve line-start escapes identically.
 */
export function isBlockTriggerEscape(
  markdown: string,
  offset: number,
  char: string,
): boolean {
  const lineStart = markdown.lastIndexOf("\n", offset - 1) + 1;
  const beforeOnLine = markdown.slice(lineStart, offset).trimStart();

  // At start of line: keep escape for block-trigger characters.
  if (beforeOnLine === "" && BLOCK_TRIGGERS.includes(char)) {
    return true;
  }

  // Ordered list trigger: digits followed by . or ) at start of line.
  return (
    (char === "." || char === ")") &&
    beforeOnLine !== "" &&
    /^\d+$/.test(beforeOnLine)
  );
}

/**
 * True when the line containing `offset` has at least one unescaped,
 * non-code pipe — i.e. it looks like a GFM table row. On such lines a
 * `\|` is the only way to put a literal pipe inside a cell; stripping
 * the escape would change the column count and break the table.
 */
function lineHasUnescapedPipe(
  markdown: string,
  offset: number,
  mask: Uint8Array,
): boolean {
  const lineStart = markdown.lastIndexOf("\n", offset - 1) + 1;
  const nl = markdown.indexOf("\n", offset);
  const lineEnd = nl === -1 ? markdown.length : nl;

  for (let i = lineStart; i < lineEnd; i++) {
    if (markdown[i] !== "|" || mask[i]) continue;
    // Backslash parity: odd = this pipe is escaped (cell content).
    let backslashes = 0;
    for (let k = i - 1; k >= lineStart && markdown[k] === "\\"; k--) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return true;
  }
  return false;
}

/**
 * Strip unnecessary backslash escapes from pasted markdown.
 *
 * Preserves escapes at the start of a line where the character would
 * trigger block-level syntax (headings, lists, blockquotes), and `\|`
 * on table-looking lines (any unescaped pipe outside code) where the
 * escape is structurally load-bearing.
 * Also preserves all escapes inside code blocks and inline code spans.
 */
function stripUnnecessaryEscapes(markdown: string): string {
  const mask = buildCodeMask(markdown);

  return markdown.replace(ESCAPE_RE, (match, char: string, offset: number) => {
    // Never strip escapes inside code
    if (mask[offset]) return match;

    if (isBlockTriggerEscape(markdown, offset, char)) return match;

    // Keep \| inside GFM table rows — it is the only way to represent a
    // literal pipe in a cell.
    if (char === "|" && lineHasUnescapedPipe(markdown, offset, mask)) {
      return match;
    }

    return char;
  });
}

/**
 * Clean pasted markdown from AI clipboard artifacts by stripping
 * unnecessary mid-line backslash escapes (code-aware).
 */
export function cleanPastedMarkdown(markdown: string): string {
  if (!markdown) return markdown;
  return stripUnnecessaryEscapes(markdown);
}
