/**
 * E08 unclosedFencedCode — detects fenced code blocks that are never closed.
 *
 * Purpose: Flag an opening fence (``` or ~~~) that has no matching closing
 * fence before end-of-file. Follows CommonMark rules: closing fence must use
 * the same character and have at least as many characters as the opening.
 * Lines with 4+ leading spaces are not fences (indented code blocks).
 */

import type { LintRule } from "../types";
import { createDiagnostic } from "../types";

// Matches a potential fence line: 0-3 optional spaces then 3+ backticks or tildes
const FENCE_OPEN_RE = /^([ ]{0,3})(`{3,}|~{3,})/;

export const unclosedFencedCode: LintRule = (_source, _mdast, { lines }) => {

  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  let openLine = -1; // 0-based index of opening line
  let openOffset = 0;
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = FENCE_OPEN_RE.exec(line);

    if (inFence) {
      if (match && match[2][0] === fenceChar && match[2].length >= fenceLen) {
        // Closing fence: rest of line after fence chars must be only whitespace
        const rest = line.slice(match[1].length + match[2].length);
        if (rest.trim() === "") {
          inFence = false;
          fenceChar = "";
          fenceLen = 0;
          openLine = -1;
        }
      }
    } else if (match) {
      inFence = true;
      fenceChar = match[2][0];
      fenceLen = match[2].length;
      openLine = i;
      openOffset = lineOffset + match[1].length; // offset to the fence chars
    }

    lineOffset += line.length + 1;
  }

  if (inFence && openLine !== -1) {
    // Find line number and column of the opening fence
    const lineNum = openLine + 1;
    const col = (lines[openLine].match(/^([ ]{0,3})/)?.[1].length ?? 0) + 1;

    return [
      createDiagnostic({
        ruleId: "E08",
        severity: "error",
        messageKey: "lint.E08",
        messageParams: {},
        line: lineNum,
        column: col,
        offset: openOffset,
        uiHint: "sourceOnly",
      }),
    ];
  }

  return [];
};
