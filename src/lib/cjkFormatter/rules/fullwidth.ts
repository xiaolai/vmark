/**
 * Group 2 — Fullwidth normalization rules.
 *
 * Converts half-width ASCII to fullwidth forms when in CJK context.
 * Protects ordered list markers ("1."), ellipses ("..."), and technical
 * subspans (URLs, versions, times) from over-conversion.
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
 * Check if a period at `dotPos` is an ordered list marker (e.g. "1.", "10.").
 * Walks back from the period through digits; if it reaches line-start or a
 * newline (possibly preceded by indentation), it's a list marker.
 */
function isOrderedListMarker(text: string, dotPos: number): boolean {
  let i = dotPos - 1;
  // Must have at least one digit before the dot
  if (i < 0 || text[i] < "0" || text[i] > "9") return false;
  // Walk back through digits
  while (i >= 0 && text[i] >= "0" && text[i] <= "9") i--;
  // Skip optional indentation (spaces/tabs)
  while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--;
  // Must be at start of string or after a newline
  return i < 0 || text[i] === "\n";
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
 * Spec Reference: Rule 3 of cjk-typography-rules-draft.md
 */
export function normalizeFullwidthPunctuation(text: string): string {
  // Scan for Latin spans and their technical subspans
  const latinSpans = scanLatinSpans(text);

  // Process character by character
  const result: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const fullwidth = PUNCTUATION_MAP[char];

    // If not a convertible punctuation, keep as-is
    if (!fullwidth) {
      result.push(char);
      continue;
    }

    // Special case: backslash escape - never convert escaped punctuation
    if (i > 0 && text[i - 1] === "\\") {
      result.push(char);
      continue;
    }

    // Special case: ellipsis - never convert periods that are part of ...
    if (char === "." && isPartOfEllipsis(text, i)) {
      result.push(char);
      continue;
    }

    // Special case: ordered list marker - never convert "1." "2." etc. at line start
    if (char === "." && isOrderedListMarker(text, i)) {
      result.push(char);
      continue;
    }

    // Check if inside a technical subspan (URL, version, time, etc.)
    if (isInTechnicalSubspan(i, latinSpans)) {
      result.push(char);
      continue;
    }

    // Get context: nearest non-space neighbors
    const leftNeighbor = getLeftNeighbor(text, i);
    const rightNeighbor = getRightNeighbor(text, i);

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
      result.push(fullwidth);
    } else {
      result.push(char);
    }
  }

  return result.join("");
}

/** Convert half-width parentheses to full-width when content is CJK. */
export function normalizeFullwidthParentheses(text: string): string {
  return text.replace(
    new RegExp(`\\(([${CJK_NO_KOREAN}][^()]*)\\)`, "g"),
    "（$1）"
  );
}

/** Convert half-width brackets to full-width when content is CJK. */
export function normalizeFullwidthBrackets(text: string): string {
  return text.replace(
    new RegExp(`\\[([${CJK_NO_KOREAN}][^\\[\\]]*)\\]`, "g"),
    "【$1】"
  );
}
