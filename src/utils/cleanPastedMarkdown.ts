/**
 * Clean Pasted Markdown
 *
 * Cleans up markdown text pasted from AI assistants (Gemini, ChatGPT, Claude)
 * into source mode. Handles two main issues:
 *
 * 1. Unnecessary backslash escapes (e.g., \| \# \* mid-line)
 * 2. Raw <br> tags inside GFM table cells
 */

import { buildCodeMask } from "./markdownCodeMask";

/** Characters that are safe to unescape when they appear mid-line. */
const SAFE_MID_LINE = "#\\-*_`|[\\]()>+.!";

/** Characters that create block-level syntax at start of line — keep escaped there. */
const BLOCK_TRIGGERS = "#-*>+";

/** Regex matching a backslash before any character in the safe set. */
const ESCAPE_RE = new RegExp(`\\\\([${SAFE_MID_LINE}])`, "g");

/** Regex matching <br>, <br/>, <br /> tags. */
const BR_TAG_RE = /<br\s*\/?>/gi;

/**
 * Strip unnecessary backslash escapes from pasted markdown.
 *
 * Preserves escapes at the start of a line where the character would
 * trigger block-level syntax (headings, lists, blockquotes).
 * Also preserves all escapes inside code blocks and inline code spans.
 */
function stripUnnecessaryEscapes(markdown: string): string {
  const mask = buildCodeMask(markdown);

  return markdown.replace(ESCAPE_RE, (match, char: string, offset: number) => {
    // Never strip escapes inside code
    if (mask[offset]) return match;

    // Find the start of the current line
    const lineStart = markdown.lastIndexOf("\n", offset - 1) + 1;
    const beforeOnLine = markdown.slice(lineStart, offset).trimStart();

    // At start of line: keep escape for block-trigger characters
    if (beforeOnLine === "" && BLOCK_TRIGGERS.includes(char)) {
      return match;
    }

    // Ordered list trigger: digits followed by . or ) at start of line
    if (
      (char === "." || char === ")") &&
      beforeOnLine !== "" &&
      /^\d+$/.test(beforeOnLine)
    ) {
      return match;
    }

    return char;
  });
}

/**
 * Convert <br> tags to newlines inside GFM table rows.
 *
 * Table rows are lines that start with `|`. Only <br> tags on those
 * lines are replaced; <br> inside inline code spans is preserved.
 */
function cleanBrTagsInTables(markdown: string, mask: Uint8Array): string {
  return markdown.replace(/^(\|.*)$/gm, (line, _g1, lineOffset: number) => {
    return line.replace(BR_TAG_RE, (brMatch: string, brOffset: number) => {
      if (mask[lineOffset + brOffset]) return brMatch;
      return "\n";
    });
  });
}

/**
 * Clean pasted markdown from AI clipboard artifacts.
 *
 * Applies in order:
 * 1. Convert <br> to newlines in table rows (code-aware)
 * 2. Strip unnecessary mid-line backslash escapes (code-aware)
 */
export function cleanPastedMarkdown(markdown: string): string {
  if (!markdown) return markdown;

  const brMask = buildCodeMask(markdown);
  let result = cleanBrTagsInTables(markdown, brMask);
  result = stripUnnecessaryEscapes(result);
  return result;
}
