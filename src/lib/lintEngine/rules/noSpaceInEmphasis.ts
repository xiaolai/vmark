/**
 * E05 noSpaceInEmphasis — detects emphasis/strong with inner spaces.
 *
 * Purpose: Flag `** bold **`, `* italic *`, `__ bold __`, `_ italic _` where
 * the author added spaces after the opening or before the closing delimiter.
 * Skips fenced code blocks, inline code spans, and star pairs in an
 * arithmetic (infix-multiplication) context like `3 * 4 * 5` or `x * y * z`.
 */

import type { LintRule } from "../types";
import { createDiagnostic } from "../types";
import { CodeBlockTracker } from "./codeBlockTracker";

interface Span {
  start: number;
  end: number;
}

/**
 * Find inline code spans in a line using CommonMark backtick-run matching:
 * a span opens with a run of N backticks and closes at the next run of
 * exactly N backticks (a run of a different length is span content).
 * Backslash-escaped backticks outside a span are literal text; backslashes
 * inside a span are literal because code spans have no escapes.
 */
function findInlineCodeSpans(line: string): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2; // escape consumes the next char (e.g. a literal backtick)
      continue;
    }
    if (ch !== "`") {
      i += 1;
      continue;
    }
    let openLen = 1;
    while (line[i + openLen] === "`") openLen += 1;
    // Search for a closing run of exactly openLen backticks.
    let j = i + openLen;
    let closeStart = -1;
    while (j < line.length) {
      if (line[j] !== "`") {
        j += 1;
        continue;
      }
      let runLen = 1;
      while (line[j + runLen] === "`") runLen += 1;
      if (runLen === openLen) {
        closeStart = j;
        break;
      }
      j += runLen; // different-length run is content inside the span
    }
    if (closeStart === -1) {
      i += openLen; // unmatched run is literal text, keep scanning after it
    } else {
      spans.push({ start: i, end: closeStart + openLen });
      i = closeStart + openLen;
    }
  }
  return spans;
}

/** Returns true if `index` falls inside any of the given spans. */
function isInsideSpan(spans: Span[], index: number): boolean {
  return spans.some((s) => index >= s.start && index < s.end);
}

// Matches ** text ** or * text * style patterns
const STAR_RE = /(\*{1,2}) (.+?) \1/g;
// Matches __ text __ or _ text _ style patterns
const UNDER_RE = /(_{1,2}) (.+?) \1/g;

/**
 * A plausible arithmetic operand: a number or a short (≤ 3 chars)
 * identifier, allowing common wrapping punctuation like `(x` or `5.`.
 */
function isOperandLike(token: string): boolean {
  const core = token.replace(/^[([{]+|[)\]}.,;:!?]+$/g, "");
  return /^(?:\d+(?:\.\d+)?|\w{1,3})$/.test(core);
}

/**
 * True when a STAR_RE match is infix multiplication, not emphasis: in
 * `3 * 4 * 5` or `x * y * z` the spaced stars sit between operand-like
 * tokens on BOTH flanks AND in the middle. A wordy middle
 * (`chapter 2 * important * 3 examples`) or a wordy flank
 * (`some * emphasized * text`) is emphasis and still flags.
 */
function isArithmeticContext(
  line: string,
  start: number,
  end: number,
  inner: string,
): boolean {
  const left = line.slice(0, start).match(/(\S+)\s+$/);
  const right = line.slice(end).match(/^\s+(\S+)/);
  if (!left || !right) return false;
  return (
    isOperandLike(left[1]) && isOperandLike(right[1]) && isOperandLike(inner)
  );
}

export const noSpaceInEmphasis: LintRule = (_source, _mdast, { lines }) => {
  const diagnostics = [];
  const tracker = new CodeBlockTracker();
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inCode = tracker.processLine(line);

    if (!inCode) {
      const codeSpans = findInlineCodeSpans(line);
      for (const re of [STAR_RE, UNDER_RE]) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(line)) !== null) {
          if (
            re === STAR_RE &&
            isArithmeticContext(
              line,
              match.index,
              match.index + match[0].length,
              match[2],
            )
          ) {
            continue;
          }
          if (!isInsideSpan(codeSpans, match.index)) {
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
