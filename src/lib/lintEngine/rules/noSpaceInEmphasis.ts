/**
 * E05 noSpaceInEmphasis — detects emphasis/strong with inner spaces.
 *
 * Purpose: Flag `** bold **`, `* italic *`, `__ bold __`, `_ italic _` where
 * the author added spaces after the opening AND before the closing delimiter.
 *
 * SYMMETRIC only, deliberately. A one-sided opener (`* italic*`) is the same
 * shape as a LIST BULLET followed by real emphasis — `* some *emph* here`
 * matches `\* (.+?)\*` exactly — and as ordinary prose preceding an emphasis
 * run, so detecting it by regex flags correct documents. Distinguishing them
 * needs the inline parser, not another pattern (audit 20260907 round 2).
 *
 * What counts as scannable text is `sourceMask`'s answer, shared with E01, E04
 * and W03. This rule used to carry its own fence tracker (blind to a fence a
 * container prefixes) and its own per-LINE code-span scanner, which could not
 * see a span that crossed a line ending and only tested a match's START
 * against it — so `a ** b ``c ** d`` e`, whose closing marker is inside code,
 * was reported (audit round 3, #831/#836/#837). Masking answers all three: a
 * masked delimiter cannot be matched at either end.
 *
 * @coordinates-with src/lib/lintEngine/rules/sourceMask.ts — which text is prose
 * @coordinates-with src/lib/lintEngine/rules/labelUtils.ts — backslash-escape parity
 * @module lib/lintEngine/rules/noSpaceInEmphasis
 */

import type { LintDiagnostic, LintRule } from "../types";
import { ruleEmission } from "../ruleMeta";
import { createDiagnostic } from "../types";
import { isEscapedAt } from "./labelUtils";
import { maskedLines } from "./sourceMask";

/** Matches ** text ** or * text * style patterns. */
const STAR_RE = /(\*{1,2}) (.+?) \1/g;
/** Matches __ text __ or _ text _ style patterns. */
const UNDER_RE = /(_{1,2}) (.+?) \1/g;

/**
 * A plausible arithmetic operand: a number (sign and decimals allowed) or a
 * SHORT identifier, tolerating wrapping punctuation like `(x` or `5.`.
 *
 * The ≤ 3-character cap is load-bearing and stays. Widening it to "any
 * identifier", which is the obvious reading of "be Unicode-aware", makes
 * `some * emphasized * text` operand-like on all three flanks and silences the
 * rule on exactly the shape it exists to catch. What round 3 fixed is the
 * ALPHABET, not the length: `\w` is ASCII-only, so `甲 * 乙 * 丙` read as
 * emphasis, and no sign was allowed, so `x * -4 * y` did too (#834).
 */
function isOperandLike(token: string): boolean {
  const core = token.replace(/^[([{]+|[)\]}.,;:!?]+$/g, "");
  return /^(?:[+-]?\d+(?:\.\d+)?|[\p{L}\p{N}_]{1,3})$/u.test(core);
}

/**
 * True when a STAR_RE match is infix multiplication, not emphasis: in
 * `3 * 4 * 5` or `x * y * z` the spaced stars sit between operand-like
 * tokens on BOTH flanks AND in the middle. A wordy middle
 * (`chapter 2 * important * 3 examples`) or a wordy flank
 * (`some * emphasized * text`) is emphasis and still flags.
 */
function isArithmeticContext(line: string, start: number, end: number, inner: string): boolean {
  const left = line.slice(0, start).match(/(\S+)\s+$/);
  const right = line.slice(end).match(/^\s+(\S+)/);
  if (!left || !right) return false;
  return isOperandLike(left[1]) && isOperandLike(right[1]) && isOperandLike(inner);
}

/** The spaced-emphasis matches on one already-masked line, as diagnostics. */
function scanLine(line: string, lineNumber: number, lineOffset: number): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  for (const re of [STAR_RE, UNDER_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const end = match.index + match[0].length;
      // A BACKSLASH before the opening delimiter makes it a literal character,
      // so `a \* text * b` is one escaped star and one real one, not emphasis
      // (#833). Parity is counted, not a single character tested: `\\*` is an
      // escaped backslash followed by a real delimiter.
      if (isEscapedAt(line, match.index)) continue;
      if (re === STAR_RE && isArithmeticContext(line, match.index, end, match[2])) continue;

      const offset = lineOffset + match.index;
      diagnostics.push(
        createDiagnostic({
          ...ruleEmission("E05"),
          messageKey: "lint.E05",
          messageParams: {},
          line: lineNumber,
          column: match.index + 1,
          offset,
          endOffset: offset + match[0].length,
          uiHint: "sourceOnly",
        }),
      );
    }
  }
  return diagnostics;
}

export const noSpaceInEmphasis: LintRule = (_source, mdast, { lines, lineOffsets }) => {
  const diagnostics: LintDiagnostic[] = [];
  const scannable = maskedLines(lines, mdast);
  for (let i = 0; i < scannable.length; i++) {
    diagnostics.push(...scanLine(scannable[i], i + 1, lineOffsets[i]));
  }
  return diagnostics;
};
