/**
 * E05 noSpaceInEmphasis — detects emphasis/strong with inner spaces.
 *
 * Purpose: Flag `** bold **`, `* italic *`, `__ bold __`, `_ italic _` where
 * the author added spaces after the opening or before the closing delimiter.
 * Skips fenced code blocks and inline code spans.
 */

import type { LintRule } from "../types";
import { createDiagnostic } from "../types";
import { CodeBlockTracker } from "./codeBlockTracker";

/** Returns true if the match at `matchIndex` is inside an inline code span. */
function isInsideInlineCode(line: string, matchIndex: number): boolean {
  let inCode = false;
  let i = 0;
  while (i < matchIndex) {
    if (line[i] === "`") {
      inCode = !inCode;
    }
    i++;
  }
  return inCode;
}

// Matches ** text ** or * text * style patterns
const STAR_RE = /(\*{1,2}) (.+?) \1/g;
// Matches __ text __ or _ text _ style patterns
const UNDER_RE = /(_{1,2}) (.+?) \1/g;

export const noSpaceInEmphasis: LintRule = (_source, _mdast, { lines }) => {
  const diagnostics = [];
  const tracker = new CodeBlockTracker();
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inCode = tracker.processLine(line);

    if (!inCode) {
      for (const re of [STAR_RE, UNDER_RE]) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(line)) !== null) {
          if (!isInsideInlineCode(line, match.index)) {
            const col = match.index + 1;
            const offset = lineOffset + match.index;
            diagnostics.push(
              createDiagnostic({
                ruleId: "E05",
                severity: "warning",
                messageKey: "lint.E05",
                messageParams: {},
                line: i + 1,
                column: col,
                offset,
                endOffset: offset + match[0].length,
                uiHint: "sourceOnly",
              })
            );
          }
        }
      }
    }

    lineOffset += line.length + 1;
  }

  return diagnostics;
};
