/**
 * E08 unclosedFencedCode — detects fenced code blocks that are never closed.
 *
 * Purpose: Flag an opening fence (``` or ~~~) that has no matching closing
 * fence before end-of-file. Follows CommonMark rules: closing fence must use
 * the same character and have at least as many characters as the opening.
 * Lines with 4+ leading spaces are not fences (indented code blocks).
 *
 * Two CommonMark details the first implementation missed (audit R3 #861/#862):
 * a backtick opener may not carry a backtick in its info string, and the text
 * after a CLOSING fence may only be spaces and tabs — `trim()` also consumed
 * NBSP and every other Unicode space, so a line that does not close a fence
 * closed it. The spaces-and-tabs check deliberately tolerates ONE trailing CR:
 * the shared line index splits on "\n", so every line of a CRLF document
 * retains it, and rejecting it would report an unclosed fence on every
 * correctly-closed CRLF file.
 */

import type { LintRule } from "../types";
import { ruleEmission } from "../ruleMeta";
import { createDiagnostic } from "../types";

// Matches a potential fence line: 0-3 optional spaces then 3+ backticks or tildes
const FENCE_OPEN_RE = /^([ ]{0,3})(`{3,}|~{3,})/;

/** Only spaces and tabs may follow a closing fence — plus a CRLF's stray CR. */
const CLOSING_SUFFIX_RE = /^[ \t]*\r?$/;

interface FenceLine {
  /** Leading indent, 0-3 spaces. */
  indent: string;
  /** The run of fence characters. */
  run: string;
  /** Everything after the run on that line. */
  rest: string;
}

/** Classify a line as a possible fence, or `null` if it is not one at all. */
function classifyFence(line: string): FenceLine | null {
  const match = FENCE_OPEN_RE.exec(line);
  if (!match) return null;
  return {
    indent: match[1],
    run: match[2],
    rest: line.slice(match[1].length + match[2].length),
  };
}

/**
 * Whether `fence` opens a block. A backtick opener's info string may not
 * contain a backtick (CommonMark §4.5); a tilde opener's may.
 */
function opensFence(fence: FenceLine): boolean {
  return fence.run[0] !== "`" || !fence.rest.includes("`");
}

/** Whether `fence` closes a run of `len` `char`s. */
function closesFence(fence: FenceLine, char: string, len: number): boolean {
  return (
    fence.run[0] === char &&
    fence.run.length >= len &&
    CLOSING_SUFFIX_RE.test(fence.rest)
  );
}

export const unclosedFencedCode: LintRule = (
  _source,
  _mdast,
  { lines, lineOffsets }
) => {
  let fenceChar = "";
  let fenceLen = 0;
  let openLine = -1; // 0-based index of opening line; -1 = not in a fence
  let openIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const fence = classifyFence(lines[i]);
    if (!fence) continue;

    if (openLine !== -1) {
      if (closesFence(fence, fenceChar, fenceLen)) {
        fenceChar = "";
        fenceLen = 0;
        openLine = -1;
      }
    } else if (opensFence(fence)) {
      fenceChar = fence.run[0];
      fenceLen = fence.run.length;
      openLine = i;
      openIndent = fence.indent.length;
    }
  }

  if (openLine === -1) return [];

  return [
    createDiagnostic({
      ...ruleEmission("E08"),
      messageKey: "lint.E08",
      messageParams: {},
      line: openLine + 1,
      column: openIndent + 1,
      offset: lineOffsets[openLine] + openIndent,
      uiHint: "sourceOnly",
    }),
  ];
};
