/**
 * Group 2 — Fullwidth normalization rules.
 *
 * Converts half-width ASCII to fullwidth forms when in CJK context.
 * Protects enumerator periods ("1."), ellipses ("..."), and technical
 * subspans (URLs, versions, times) from over-conversion.
 *
 * A mark must be IMMEDIATELY adjacent to its CJK neighbour to convert
 * (WI-CJKF3.1); see `getLeftNeighbor` in ./shared.ts for why.
 *
 * @coordinates-with latinSpanScanner — technical subspan protection
 * @module lib/cjkFormatter/rules/fullwidth
 */

import { scanLatinSpans, isInTechnicalSubspan, isCJKLetter } from "../latinSpanScanner";
import {
  CJK_NO_KOREAN,
  CJK_CLOSING_BRACKETS,
  CJK_OPENING_BRACKETS,
  CJK_TERMINAL_PUNCTUATION,
  PUNCTUATION_MAP,
  getLeftNeighbor,
  getRightNeighbor,
} from "./shared";

/**
 * Convert full-width alphanumeric to half-width.
 * e.g., "１２３" → "123", "Ａ" → "A"
 */
export function normalizeFullwidthAlphanumeric(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    // Full-width numbers (0-9): U+FF10-U+FF19
    if (code >= 0xff10 && code <= 0xff19) {
      result += String.fromCharCode(code - 0xfee0);
    }
    // Full-width uppercase (A-Z): U+FF21-U+FF3A
    else if (code >= 0xff21 && code <= 0xff3a) {
      result += String.fromCharCode(code - 0xfee0);
    }
    // Full-width lowercase (a-z): U+FF41-U+FF5A
    else if (code >= 0xff41 && code <= 0xff5a) {
      result += String.fromCharCode(code - 0xfee0);
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Whether the period at `dotPos` is an ENUMERATOR — the dot of `1.`, `10.` —
 * rather than a sentence period.
 *
 * Adjacency (WI-CJKF3.1) already spares `1. 中文`, because the space after the
 * dot means neither neighbour is adjacent CJK. This still carries the
 * SPACE-LESS form `1.中文`, which is common in Chinese text and which adjacency
 * would convert to `1。中文`.
 *
 * Walks back through the digits, then through any leading line furniture:
 * indentation, blockquote markers (`>`), and ATX heading hashes. All three
 * were missing, and each was its own reproduction — `> 1.中文`, `## 1.中文`
 * and `  1.中文` all became `1。`.
 */
function isEnumeratorPeriod(text: string, dotPos: number): boolean {
  let i = dotPos - 1;
  // Must have at least one digit before the dot
  if (i < 0 || text[i] < "0" || text[i] > "9") return false;
  // Walk back through digits
  while (i >= 0 && text[i] >= "0" && text[i] <= "9") i--;
  // Walk back through leading line furniture: indentation, `>` quote markers,
  // and `#` heading marks, in any order and any nesting.
  while (i >= 0 && (text[i] === " " || text[i] === "\t" || text[i] === ">" || text[i] === "#")) {
    i--;
  }
  // Must be at start of string or after a line break
  return i < 0 || text[i] === "\n" || text[i] === "\r";
}

/** Check if a character is part of an ellipsis pattern. */
function isPartOfEllipsis(text: string, pos: number): boolean {
  /* v8 ignore next -- @preserve Always called after confirming char === ".", so the false branch of this guard is unreachable in practice */
  if (text[pos] !== ".") return false;

  const before = pos > 0 ? text[pos - 1] : "";
  const after = pos < text.length - 1 ? text[pos + 1] : "";

  return before === "." || after === ".";
}

/**
 * Normalize punctuation width based on CJK context.
 *
 * Converts ASCII punctuation to fullwidth when in CJK context.
 * Protects punctuation inside technical subspans (URLs, versions, etc.).
 *
 * A conversion changes the neighbor context of the NEXT candidate — a comma
 * that becomes ， is itself CJK terminal punctuation — so a scan that reads its
 * left neighbor from the ORIGINAL text stops a step short of the rule's own
 * semantics, and repeated formatting passes each converted one more char
 * (中,, → 中，, → 中，，).
 *
 * That propagation is resolved INSIDE one scan now (audit 20260804-F5): the
 * scan converts into a working copy and reads the left neighbor from it. The
 * old shape — rescan the whole document, convert one more char, rescan — was
 * Θ(N²) on a long punctuation run: `中` followed by 10k commas took 10k full
 * document scans (each with a fresh Latin-span scan) and froze the UI thread,
 * because the formatter is synchronous.
 *
 * Propagation is one-directional, which is what makes a single left-to-right
 * scan sufficient: every fullwidth form this rule produces (，。！？；：) is CJK
 * TERMINAL punctuation, which only the LEFT-neighbor test accepts. The right
 * test accepts CJK letters and OPENING brackets, and no conversion here yields
 * either — so a conversion can never unlock a candidate to its left.
 *
 * The outer fixed-point loop stays: the Latin-span scan is recomputed per pass
 * (a conversion can shrink a span, since fullwidth punctuation cannot be part
 * of one), so convergence is still asserted rather than assumed. It now takes
 * a bounded number of passes instead of one per converted character.
 *
 * Spec Reference: Rule 3 of cjk-typography-rules-draft.md
 */
export function normalizeFullwidthPunctuation(text: string): string {
  let prev = text;
  let next = normalizeFullwidthPunctuationOnce(prev);
  while (next !== prev) {
    prev = next;
    next = normalizeFullwidthPunctuationOnce(prev);
  }
  return next;
}

/**
 * One left-to-right scan of the conversion, propagating converted-neighbor
 * context as it goes; see the fixed-point wrapper above.
 */
function normalizeFullwidthPunctuationOnce(text: string): string {
  // Scan for Latin spans and their technical subspans
  const latinSpans = scanLatinSpans(text);

  // The working copy. Conversions are 1 code unit → 1 code unit, so index i of
  // `out` always corresponds to index i of `text`; `split("")` splits by code
  // unit (NOT by code point), which is what keeps that true for surrogate
  // pairs. Guards read `text` — they key on characters this rule never
  // converts (`\`, `.`, digits, spaces, newlines), so original and working
  // copy agree there — while the LEFT-neighbor test reads `out`.
  const out = text.split("");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const fullwidth = PUNCTUATION_MAP[char];

    // If not a convertible punctuation, keep as-is
    if (!fullwidth) continue;

    // Special case: backslash escape - never convert escaped punctuation
    if (i > 0 && text[i - 1] === "\\") continue;

    // Special case: ellipsis - never convert periods that are part of ...
    // (A period adjacent to another period is protected on BOTH sides, so no
    // conversion can ever create or destroy an ellipsis mid-scan.)
    if (char === "." && isPartOfEllipsis(text, i)) continue;

    // Special case: an ENUMERATOR period — the dot of "1.", "10." — at the
    // start of a line, including under `>` quote markers and `#` heading marks.
    if (char === "." && isEnumeratorPeriod(text, i)) continue;

    // Check if inside a technical subspan (URL, version, time, etc.)
    if (isInTechnicalSubspan(i, latinSpans)) continue;

    // Get context: the IMMEDIATELY adjacent neighbours (WI-CJKF3.1). LEFT comes
    // from the working copy — that is the propagation. RIGHT comes from the
    // original, and may: no conversion produces a CJK letter or an opening
    // bracket, the only two things the right-hand test accepts.
    const leftNeighbor = getLeftNeighbor(out, i, false);
    const rightNeighbor = getRightNeighbor(text, i, false);

    // Check if either neighbor is a CJK character or CJK bracket
    const leftIsCJK = leftNeighbor && (
      isCJKLetter(leftNeighbor) ||
      CJK_CLOSING_BRACKETS.includes(leftNeighbor) ||
      CJK_TERMINAL_PUNCTUATION.includes(leftNeighbor)
    );
    const rightIsCJK = rightNeighbor && (
      isCJKLetter(rightNeighbor) ||
      CJK_OPENING_BRACKETS.includes(rightNeighbor)
    );

    // Convert if either neighbor is CJK
    if (leftIsCJK || rightIsCJK) {
      out[i] = fullwidth;
    }
  }

  return out.join("");
}

/** Convert half-width parentheses to full-width when content is CJK. */
export function normalizeFullwidthParentheses(text: string): string {
  return text.replace(
    new RegExp(`\\(([${CJK_NO_KOREAN}][^()]*)\\)`, "g"),
    "（$1）"
  );
}

/**
 * Convert half-width brackets to full-width when content is CJK.
 *
 * Skips bracket pairs that are markdown link/image/reference syntax:
 *   - closing bracket followed by `(`, `[`, or `:` — inline links
 *     `[中文](url)`, reference links `[中文][ref]`, definitions `[中文]: url`
 *   - opening bracket preceded by `!` or `]` — image alt text `![中文]` and
 *     reference labels `[text][中文标签]`
 *
 * Backslash-escaped brackets inside a label (`[中文\]文](url)`) are label
 * content, not delimiters: the content pattern consumes `\x` pairs whole, so
 * an escaped `]` can never close the label and defeat the link lookarounds.
 */
export function normalizeFullwidthBrackets(text: string): string {
  return text.replace(
    new RegExp(
      `(?<![\\]!])\\[([${CJK_NO_KOREAN}](?:\\\\.|[^\\[\\]\\\\])*)\\](?![([:])`,
      "g"
    ),
    "【$1】"
  );
}
