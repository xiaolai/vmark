/**
 * E03 noReversedLink — detects reversed link syntax (text)[url].
 *
 * Purpose: Flag `(text)[url]` which is a common mistake when the author
 * accidentally reverses the correct Markdown link syntax `[text](url)`.
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

const REVERSED_LINK_RE = /\(([^)]+)\)\[([^\]]+)\]/g;

export const noReversedLink: LintRule = (_source, _mdast, { lines }) => {
  const diagnostics = [];
  const tracker = new CodeBlockTracker();
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inCode = tracker.processLine(line);

    if (!inCode) {
      REVERSED_LINK_RE.lastIndex = 0;
      let match;
      while ((match = REVERSED_LINK_RE.exec(line)) !== null) {
        if (!isInsideInlineCode(line, match.index)) {
          const col = match.index + 1;
          const offset = lineOffset + match.index;
          diagnostics.push(
            createDiagnostic({
              ruleId: "E03",
              severity: "error",
              messageKey: "lint.E03",
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

    lineOffset += line.length + 1; // +1 for the newline
  }

  return diagnostics;
};
