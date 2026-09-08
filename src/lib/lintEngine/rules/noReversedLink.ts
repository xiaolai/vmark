/**
 * E03 noReversedLink — detects reversed link syntax (text)[url].
 *
 * Purpose: Flag `(text)[url]` which is a common mistake when the author
 * accidentally reverses the correct Markdown link syntax `[text](url)`.
 *
 * Code regions come from the MDAST, not from a second parser (audit R3
 * #825/#826/#829). This rule used to carry its own `isInsideInlineCode`, which
 * toggled a boolean on EVERY backtick — so one literal backtick anywhere on a
 * line silently swallowed the rest of it, a multi-backtick span did not close
 * where CommonMark says it closes, and a span crossing a line ending was not a
 * span at all. It also skipped fences through a line-prefix tracker that only
 * recognises a fence at the start of a line, so a fenced block inside a
 * blockquote or a list item was scanned as prose, and an indented code block
 * always was. Every one of those shapes is decided by the real parser, which
 * has already run: `code` and `inlineCode` node ranges mask the source, and a
 * match intersecting one is not reported.
 *
 * The scan itself is escape- and nesting-aware (#827): `\(text)[url]` is a
 * literal parenthesis, and `(a (b))[url]` is a reversed link the old flat
 * `\(([^)]+)\)\[([^\]]+)\]` could not see.
 */

import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import type { LintRule } from "../types";
import { ruleEmission } from "../ruleMeta";
import { createDiagnostic } from "../types";

interface Range {
  start: number;
  end: number;
}

/** A reversed-link match within one line: `(text)[label]`. */
interface ReversedMatch {
  /** 0-based index into the line where `(` sits. */
  index: number;
  /** Length of the whole `(text)[label]` run. */
  length: number;
}

/**
 * Absolute source ranges the parser identified as code — fenced, indented and
 * inline alike, at any container depth. A node without offsets contributes
 * nothing rather than a bogus `0` range.
 */
function codeRanges(mdast: Root): Range[] {
  const ranges: Range[] = [];
  visit(mdast, (node) => {
    if (node.type !== "code" && node.type !== "inlineCode") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start == null || end == null) return;
    ranges.push({ start, end });
  });
  return ranges;
}

/** True when `[start, end)` overlaps any masked range. */
function intersectsAny(ranges: Range[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

/**
 * Index of the delimiter closing the run opened at `open`, or -1.
 * Counts nesting and honours backslash escapes, both of which the previous
 * character-class regex ignored.
 */
function matchDelimiter(
  line: string,
  open: number,
  openCh: string,
  closeCh: string
): number {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i += 1; // the escaped character is literal
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Every `(text)[label]` run on one line, with non-empty text and label. */
function findReversedLinks(line: string): ReversedMatch[] {
  const matches: ReversedMatch[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "(") {
      i += 1;
      continue;
    }
    const closeParen = matchDelimiter(line, i, "(", ")");
    if (closeParen === -1) break; // no balanced ")" anywhere after here
    if (closeParen > i + 1 && line[closeParen + 1] === "[") {
      const closeBracket = matchDelimiter(line, closeParen + 1, "[", "]");
      if (closeBracket > closeParen + 2) {
        matches.push({ index: i, length: closeBracket + 1 - i });
        i = closeBracket + 1;
        continue;
      }
    }
    i += 1;
  }
  return matches;
}

export const noReversedLink: LintRule = (_source, mdast, { lines, lineOffsets }) => {
  const masked = codeRanges(mdast);
  const diagnostics = [];

  for (let i = 0; i < lines.length; i++) {
    for (const m of findReversedLinks(lines[i])) {
      const offset = lineOffsets[i] + m.index;
      const endOffset = offset + m.length;
      if (intersectsAny(masked, offset, endOffset)) continue;
      diagnostics.push(
        createDiagnostic({
          ...ruleEmission("E03"),
          messageKey: "lint.E03",
          messageParams: {},
          line: i + 1,
          column: m.index + 1,
          offset,
          endOffset,
          uiHint: "sourceOnly",
        })
      );
    }
  }

  return diagnostics;
};
