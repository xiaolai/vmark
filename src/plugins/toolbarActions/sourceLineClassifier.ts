/**
 * Structural classification of single markdown source lines.
 *
 * Purpose: the two questions the line operations keep asking about a line —
 * "is this a paragraph continuation or the start of a structural block?" and
 * its two consumers: whether a JOIN would fuse two blocks, and whether a
 * DUPLICATE needs an explicit hard break.
 *
 * Split from `sourceBlockMove.ts` to keep both files under the size gate; the
 * move mechanics and the classification are separable concerns with one shared
 * primitive (`listIndent`).
 *
 * Key decisions:
 *   - Classification judges the line AFTER peeling any blockquote prefix — a
 *     quoted list item is still a list item, which is exactly what the raw
 *     `listIndent` reading missed when `> - one` joined `> - two` into the
 *     malformed `> - one > - two`.
 *   - Indented code (4 spaces / tab) is structural BEFORE any other reading,
 *     matching CommonMark's precedence.
 *
 * @coordinates-with sourceBlockMove.ts — the move mechanics
 * @coordinates-with sourceTextTransforms.ts — the handlers
 * @module plugins/toolbarActions/sourceLineClassifier
 */

import { enclosingFence } from "@/plugins/shared/fenceScanner";

export const isBlank = (line: string): boolean => line.trim() === "";

/** Indentation width of a list item line, or null when it is not one. */
export function listIndent(line: string): number | null {
  const m = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(line);
  return m ? m[1].length : null;
}

/** The line with any blockquote prefix peeled off. */
const peelQuote = (line: string): string => line.replace(/^\s*(?:>\s?)+/, "");

/** CommonMark thematic break: three+ of one of -_*, optionally spaced. */
const THEMATIC_BREAK_RE = /^ {0,3}([-_*])[ \t]*(?:\1[ \t]*){2,}$/;

/**
 * Whether `line` opens a structural block rather than continuing a paragraph —
 * judged AFTER peeling any blockquote prefix, because a quoted list item is
 * still a list item.
 */
function isStructuralLine(rawLine: string): boolean {
  // Four spaces of indentation is indented code BEFORE any other reading.
  if (/^(?: {4}|\t)/.test(rawLine)) return true;
  const line = peelQuote(rawLine);
  if (/^(?: {4}|\t)/.test(line)) return true;
  if (listIndent(line) !== null) return true;
  if (THEMATIC_BREAK_RE.test(line)) return true;
  // Heading, table row, HTML block open, math delimiter.
  return /^\s*(?:#{1,6}\s|\||<\/?[a-zA-Z]|\$\$)/.test(line);
}

/**
 * Whether a join would fuse two separate BLOCKS.
 *
 * Joining across a blank line merges two paragraphs, and joining two list items
 * collapses them into one — `- one` / `- two` becomes `- one - two`, quoted or
 * not. Headings, table rows and thematic breaks are equally distinct blocks
 * that must not be absorbed into a paragraph. WYSIWYG declines all of these,
 * because joinBackward has no node to join across.
 *
 * A multi-line selection joins the lines it covers, so the check runs over
 * those; a collapsed cursor joins with the line below it.
 */
export function joinWouldFuseBlocks(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): boolean {
  if (endLine > startLine) {
    for (let i = startLine; i <= endLine; i += 1) {
      if (isBlank(lines[i] ?? "")) return true;
      if (i > startLine && isStructuralLine(lines[i] ?? "")) return true;
    }
    return false;
  }
  const next = lines[startLine + 1];
  if (next === undefined) return true; // nothing below to join with
  if (isBlank(lines[startLine] ?? "") || isBlank(next)) return true;
  return isStructuralLine(next);
}

/**
 * Whether duplicating `lineIndex` should join the copies with a HARD BREAK.
 *
 * Duplicating a plain paragraph line should leave one paragraph showing two
 * lines, which in markdown needs an explicit break — a bare newline is a SOFT
 * break and renders as a single line, so the two surfaces produced different
 * documents. Structural lines (list items, table rows, headings, thematic
 * breaks, indented code, HTML, math delimiters) duplicate as siblings, and
 * appending `\` would corrupt them — `---` became the paragraph `---\`.
 */
export function duplicateNeedsHardBreak(lines: readonly string[], lineIndex: number): boolean {
  // Inside a fence the line is LITERAL TEXT, not markdown. A hard-break
  // backslash appended there is a stray character in the user's source code —
  // `const a = 1;` duplicated became `const a = 1;\` on the first copy.
  if (enclosingFence(lines, lineIndex)) return false;

  const raw = lines[lineIndex] ?? "";
  if (isBlank(raw)) return false;
  // A QUOTED paragraph is still a paragraph, so the quote marker is peeled
  // before deciding — `> text` needs the break just as `text` does.
  if (isBlank(peelQuote(raw))) return false;
  return !isStructuralLine(raw);
}
