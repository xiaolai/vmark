/**
 * E04 noMissingSpaceAtx — detects ATX headings without a space after `#`.
 *
 * Purpose: flag `#heading` where no space follows the hash run. Three things
 * decide whether a line is even a candidate, and each was wrong before round 3:
 *
 *   - the BLOCK must be prose. The rule tracked fences itself, so it saw only
 *     the ones that start their own line — and nothing at all about YAML front
 *     matter or a raw HTML block, where `#comment:` and `#notaheading` were
 *     both reported as headings. `sourceMask` asks the parser instead.
 *   - a CONTAINER may precede the hash. `> #heading` and `- #heading` are the
 *     same defect one indent in, and matching at the physical line start missed
 *     both. The prefix is consumed and the reported COLUMN stays absolute.
 *   - the offset comes from the engine's `lineOffsets`, not from a second
 *     accumulator this rule kept in step by hand.
 *
 * Lines with 4+ leading spaces (after any container prefix) are indented code
 * and are skipped.
 *
 * @coordinates-with src/lib/lintEngine/rules/sourceMask.ts — which blocks are prose
 * @module lib/lintEngine/rules/noMissingSpaceAtx
 */

import type { LintDiagnostic, LintRule } from "../types";
import { ruleEmission } from "../ruleMeta";
import { createDiagnostic } from "../types";
import { unparsedLines } from "./sourceMask";

/**
 * Matches 0-3 spaces then 1-6 hashes then a non-space, non-hash character.
 * The negative lookahead (?!#) prevents `######` from matching: `#{1,6}` can
 * match 1-5 hashes, then (?!#) would fail on the 6th `#` as \S, so `######`
 * (all hashes, no following non-hash) is correctly excluded.
 */
const ATX_NO_SPACE_RE = /^([ ]{0,3})(#{1,6})(?!#)(\S)/;

/**
 * Blockquote markers and list markers a heading may legally sit behind.
 *
 * Anchored and repeated by the caller so `- > #x` is consumed segment by
 * segment; a list marker takes 1-4 spaces of padding, because 5+ means the
 * content starts one space in and the rest is indented code.
 */
const CONTAINER_PREFIX_RE = /^(?: {0,3}>[ \t]?| {0,3}(?:[-*+]|\d{1,9}[.)])(?:\t| {1,4}(?! )))/;

/** How much of `line` is container prefix — blockquote markers and list markers. */
function containerPrefixLength(line: string): number {
  let consumed = 0;
  for (;;) {
    const match = CONTAINER_PREFIX_RE.exec(line.slice(consumed));
    if (!match || match[0].length === 0) return consumed;
    consumed += match[0].length;
  }
}

/** The E04 diagnostic for a hash run starting at `column` (1-based) on `line`. */
function malformedHeading(line: number, column: number, offset: number, hashes: string): LintDiagnostic {
  return createDiagnostic({
    ...ruleEmission("E04"),
    messageKey: "lint.E04",
    messageParams: {},
    line,
    column,
    offset,
    endOffset: offset + hashes.length + 1,
    uiHint: "sourceOnly",
  });
}

export const noMissingSpaceAtx: LintRule = (_source, mdast, { lines, lineOffsets }) => {
  const diagnostics: LintDiagnostic[] = [];
  const skip = unparsedLines(mdast);

  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i + 1)) continue;

    const line = lines[i];
    const prefix = containerPrefixLength(line);
    const rest = line.slice(prefix);

    // 4+ spaces past the container prefix is an indented code block.
    if ((rest.match(/^ */)?.[0].length ?? 0) >= 4) continue;

    const match = ATX_NO_SPACE_RE.exec(rest);
    if (!match) continue;

    const start = prefix + match[1].length;
    diagnostics.push(malformedHeading(i + 1, start + 1, lineOffsets[i] + start, match[2]));
  }

  return diagnostics;
};
