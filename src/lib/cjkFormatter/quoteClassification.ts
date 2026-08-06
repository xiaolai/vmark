/**
 * Quote character classification — the token-level layer under quotePairing.
 *
 * Purpose: decide what a quote CHARACTER is before any pairing happens:
 * apostrophe (don't), decade abbreviation ('90s), measurement prime (5'10"),
 * or an open/close quote role. Split out of quotePairing.ts (which owns the
 * stack-based pairing and conversion) to keep both under the file-size gate.
 *
 * Key decisions:
 *   - Curly glyphs carry their role (“/‘ open, ”/’ close): classifying them
 *     by whitespace context made the role flip between formatting passes when
 *     the pipeline's own spacing rules inserted a space next to the glyph
 *     (non-idempotence, WI-5)
 *   - Corner brackets 「」『』 have fixed roles by nature (CORNER_QUOTE_ROLES)
 *   - Straight quotes are classified from context: whitespace/bracket
 *     neighbors, then the open-stack state, defaulting to open
 *
 * @coordinates-with quotePairing.ts — tokenizeQuotes consumes every export here
 * @module lib/cjkFormatter/quoteClassification
 */

// Quote characters
export const STRAIGHT_DOUBLE = '"';
export const STRAIGHT_SINGLE = "'";
export const CURLY_DOUBLE_OPEN = "“"; // "
export const CURLY_DOUBLE_CLOSE = "”"; // "
export const CURLY_SINGLE_OPEN = "‘"; // '
export const CURLY_SINGLE_CLOSE = "’"; // '
export const CORNER_DOUBLE_OPEN = "「";
export const CORNER_DOUBLE_CLOSE = "」";
export const CORNER_SINGLE_OPEN = "『";
export const CORNER_SINGLE_CLOSE = "』";

// Character sets for context detection
const OPENING_BRACKETS = "([{（【《〈「『";
const CLOSING_BRACKETS = ")]}）】》〉」』";
const TERMINAL_PUNCTUATION = "，。！？；：、.,!?;:";

export type QuoteType = "double" | "single";
export type QuoteRole = "open" | "close" | "apostrophe" | "prime" | "ambiguous";

/** Fixed-role corner bracket lookup: char → [type, role]. */
export const CORNER_QUOTE_ROLES: Record<string, [QuoteType, "open" | "close"]> = {
  [CORNER_DOUBLE_OPEN]: ["double", "open"],
  [CORNER_DOUBLE_CLOSE]: ["double", "close"],
  [CORNER_SINGLE_OPEN]: ["single", "open"],
  [CORNER_SINGLE_CLOSE]: ["single", "close"],
};

/**
 * Check if character at position is part of an apostrophe pattern
 * Examples: don't, it's, l'amour, Xiaolai's
 */
export function isApostrophe(text: string, pos: number): boolean {
  const char = text[pos];
  /* v8 ignore next 3 -- @preserve structurally unreachable: isApostrophe is only called in tokenizeQuotes when type==="single", guaranteeing char is one of the three single-quote variants */
  if (char !== "'" && char !== CURLY_SINGLE_CLOSE && char !== CURLY_SINGLE_OPEN) {
    return false;
  }

  const before = pos > 0 ? text[pos - 1] : "";
  const after = pos < text.length - 1 ? text[pos + 1] : "";

  // Letter + ' + letter: don't, it's, l'amour
  if (/[a-zA-Z]/.test(before) && /[a-zA-Z]/.test(after)) {
    return true;
  }

  // Letter + ' + s (possessive): Xiaolai's
  // Note: this block is structurally unreachable — if after==="s", the letter+'+letter check above
  // already returns true (since "s" passes /[a-zA-Z]/).
  /* v8 ignore next 5 -- @preserve unreachable: when after==="s", the letter+letter contraction branch above fires first; "s" always matches /[a-zA-Z]/ */
  if (/[a-zA-Z]/.test(before) && after.toLowerCase() === "s") {
    // Check if followed by word boundary
    const afterS = pos + 2 < text.length ? text[pos + 2] : "";
    if (!/[a-zA-Z]/.test(afterS)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if character at position is part of a decade abbreviation
 * Example: '90s
 */
export function isDecadeAbbreviation(text: string, pos: number): boolean {
  const char = text[pos];
  if (char !== "'" && char !== CURLY_SINGLE_OPEN) {
    return false;
  }

  // Must not be preceded by a digit (that would be feet/inches like 5'10")
  const before = pos > 0 ? text[pos - 1] : "";
  if (/[0-9]/.test(before)) {
    return false;
  }

  // Check for pattern: ' + digit + digit + optional 's'
  const after1 = pos + 1 < text.length ? text[pos + 1] : "";
  const after2 = pos + 2 < text.length ? text[pos + 2] : "";

  if (/[0-9]/.test(after1) && /[0-9]/.test(after2)) {
    return true;
  }

  return false;
}

/**
 * Check if character at position is part of a measurement prime
 * Examples: 5'10" (feet/inches), 6', 12"
 */
export function isPrime(text: string, pos: number): boolean {
  const char = text[pos];
  const before = pos > 0 ? text[pos - 1] : "";

  // Single prime (feet): digit + '
  if ((char === "'" || char === CURLY_SINGLE_CLOSE) && /[0-9]/.test(before)) {
    return true;
  }

  // Double prime (inches): digit + " or digit' + digit + "
  if ((char === '"' || char === CURLY_DOUBLE_CLOSE) && /[0-9]/.test(before)) {
    // Check if this looks like feet/inches pattern
    // Look back for pattern like 5'10
    for (let i = pos - 1; i >= 0 && i > pos - 5; i--) {
      if (text[i] === "'" || text[i] === CURLY_SINGLE_CLOSE) {
        return true;
      }
      if (!/[0-9]/.test(text[i])) {
        break;
      }
    }
    // Just digit + " could be inches
    return true;
  }

  return false;
}

/**
 * Classify a quote as OPEN or CLOSE based on context
 */
export function classifyQuote(
  text: string,
  pos: number,
  type: QuoteType,
  doubleStack: number[],
  singleStack: number[]
): QuoteRole {
  // Curly glyphs carry their role — “/‘ open, ”/’ close (apostrophe/prime
  // filtering already happened in tokenizeQuotes). Classifying them by
  // whitespace context instead made the role FLIP between passes when the
  // pipeline's own spacing rules inserted a space next to the glyph:
  // hello“， classified “ as close (letter on the left) on pass 1, then as
  // open on pass 2 once quote spacing had put a space before it, so a pair
  // materialized on the second pass and got re-converted (non-idempotent).
  const char = text[pos];
  if (char === CURLY_DOUBLE_OPEN || char === CURLY_SINGLE_OPEN) {
    return "open";
  }
  if (char === CURLY_DOUBLE_CLOSE || char === CURLY_SINGLE_CLOSE) {
    return "close";
  }

  // Get neighbors (skip whitespace)
  let leftNeighbor = "";
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] !== " " && text[i] !== "\t") {
      leftNeighbor = text[i];
      break;
    }
  }

  let rightNeighbor = "";
  for (let i = pos + 1; i < text.length; i++) {
    if (text[i] !== " " && text[i] !== "\t") {
      rightNeighbor = text[i];
      break;
    }
  }

  const atStart = pos === 0 || text[pos - 1] === "\n";
  const atEnd = pos === text.length - 1 || text[pos + 1] === "\n";
  const leftIsWhitespace = pos === 0 || /\s/.test(text[pos - 1]);
  const rightIsWhitespace = pos === text.length - 1 || /\s/.test(text[pos + 1]);
  const leftIsOpenBracket = OPENING_BRACKETS.includes(leftNeighbor);
  const rightIsCloseBracket = CLOSING_BRACKETS.includes(rightNeighbor);
  const rightIsTerminal = TERMINAL_PUNCTUATION.includes(rightNeighbor);

  // Strong OPEN signals
  if (atStart || leftIsWhitespace || leftIsOpenBracket) {
    return "open";
  }

  // Strong CLOSE signals
  if (atEnd || rightIsWhitespace || rightIsCloseBracket || rightIsTerminal) {
    return "close";
  }

  // Check stack for matching opener
  const stack = type === "double" ? doubleStack : singleStack;
  if (stack.length > 0) {
    return "close";
  }

  // Default to open
  return "open";
}
