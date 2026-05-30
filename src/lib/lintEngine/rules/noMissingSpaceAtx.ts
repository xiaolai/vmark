/**
 * E04 noMissingSpaceAtx — detects ATX headings without a space after #.
 *
 * Purpose: Flag `#heading` patterns at line start (with 0-3 optional leading
 * spaces) where no space follows the hash sequence. Lines with 4+ leading
 * spaces are indented code blocks and are skipped. Fenced code blocks are
 * also skipped.
 */

import type { LintRule } from "../types";
import { createDiagnostic } from "../types";
import { CodeBlockTracker } from "./codeBlockTracker";

// Matches 0-3 spaces then 1-6 hashes then a non-space, non-hash character.
// The negative lookahead (?!#) prevents `######` from matching: `#{1,6}` can
// match 1-5 hashes, then (?!#) would fail on the 6th `#` as \S, so `######`
// (all hashes, no following non-hash) is correctly excluded.
const ATX_NO_SPACE_RE = /^([ ]{0,3})(#{1,6})(?!#)(\S)/;

export const noMissingSpaceAtx: LintRule = (_source, _mdast, { lines }) => {
  const diagnostics = [];
  const tracker = new CodeBlockTracker();
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inCode = tracker.processLine(line);

    if (!inCode) {
      // Skip indented code blocks (4+ spaces)
      const leadingSpaces = line.match(/^( *)/)?.[1].length ?? 0;
      if (leadingSpaces >= 4) {
        lineOffset += line.length + 1;
        continue;
      }

      const match = ATX_NO_SPACE_RE.exec(line);
      if (match) {
        const leadingPart = match[1]; // 0-3 spaces
        const hashes = match[2];
        // column is right after the leading spaces, at the first #
        const col = leadingPart.length + 1;
        const offset = lineOffset + leadingPart.length;
        diagnostics.push(
          createDiagnostic({
            ruleId: "E04",
            severity: "error",
            messageKey: "lint.E04",
            messageParams: {},
            line: i + 1,
            column: col,
            offset,
            endOffset: offset + hashes.length + 1,
            uiHint: "sourceOnly",
          })
        );
      }
    }

    lineOffset += line.length + 1;
  }

  return diagnostics;
};
