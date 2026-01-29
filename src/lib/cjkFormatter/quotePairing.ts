/**
 * Stack-based Quote Pairing Algorithm
 *
 * Implements robust quote pairing with:
 * - Stack-based OPEN/CLOSE classification
 * - Apostrophe/prime detection (don't, 5'10")
 * - CJK context detection for glyph selection
 * - Orphan cleanup when outer quotes close
 *
 * Spec Reference: Rule 6, Section 6.1 of cjk-typography-rules-draft.md
 */

import { isCJKLetter } from "./latinSpanScanner";

// Quote characters
const STRAIGHT_DOUBLE = '"';
const STRAIGHT_SINGLE = "'";
const CURLY_DOUBLE_OPEN = "\u201c"; // "
const CURLY_DOUBLE_CLOSE = "\u201d"; // "
const CURLY_SINGLE_OPEN = "\u2018"; // '
const CURLY_SINGLE_CLOSE = "\u2019"; // '
const CORNER_DOUBLE_OPEN = "「";
const CORNER_DOUBLE_CLOSE = "」";
const CORNER_SINGLE_OPEN = "『";
const CORNER_SINGLE_CLOSE = "』";

// Character sets for context detection
const OPENING_BRACKETS = "([{（【《〈「『";
const CLOSING_BRACKETS = ")]}）】》〉」』";
const TERMINAL_PUNCTUATION = "，。！？；：、.,!?;:";

export type QuoteType = "double" | "single";
export type QuoteRole = "open" | "close" | "apostrophe" | "prime" | "ambiguous";

export interface QuoteToken {
  /** Position in text */
  index: number;
  /** The quote character */
  char: string;
  /** Double or single quote */
  type: QuoteType;
  /** Classified role */
  role: QuoteRole;
}

export interface QuotePair {
  /** Position of opening quote */
  openIndex: number;
  /** Position of closing quote */
  closeIndex: number;
  /** Quote type */
  type: QuoteType;
  /** The quoted content (excluding quotes) */
  content: string;
  /** Whether the pair involves CJK context */
  isCJKInvolved: boolean;
}

export interface PairingResult {
  /** Successfully paired quotes */
  pairs: QuotePair[];
  /** Unmatched quotes */
  orphans: QuoteToken[];
}

/**
 * Check if character at position is part of an apostrophe pattern
 * Examples: don't, it's, l'amour, Xiaolai's
 */
function isApostrophe(text: string, pos: number): boolean {
  const char = text[pos];
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
function isDecadeAbbreviation(text: string, pos: number): boolean {
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
function isPrime(text: string, pos: number): boolean {
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
function classifyQuote(
  text: string,
  pos: number,
  type: QuoteType,
  doubleStack: number[],
  singleStack: number[]
): QuoteRole {
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

/**
 * Check if a span involves CJK context
 * - Content contains CJK letters, OR
 * - Left boundary touches CJK, OR
 * - Right boundary touches CJK
 */
function checkCJKInvolvement(
  text: string,
  openIndex: number,
  closeIndex: number
): boolean {
  // Check content
  const content = text.slice(openIndex + 1, closeIndex);
  for (const char of content) {
    if (isCJKLetter(char)) {
      return true;
    }
  }

  // Check left boundary (character before opening quote)
  if (openIndex > 0) {
    const leftChar = text[openIndex - 1];
    if (isCJKLetter(leftChar)) {
      return true;
    }
  }

  // Check right boundary (character after closing quote)
  if (closeIndex < text.length - 1) {
    const rightChar = text[closeIndex + 1];
    if (isCJKLetter(rightChar)) {
      return true;
    }
  }

  return false;
}

/**
 * Tokenize quotes in text, filtering out apostrophes and primes
 */
export function tokenizeQuotes(text: string): QuoteToken[] {
  const tokens: QuoteToken[] = [];
  const doubleStack: number[] = [];
  const singleStack: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    let type: QuoteType | null = null;
    let isQuoteChar = false;

    // Identify quote characters
    if (
      char === STRAIGHT_DOUBLE ||
      char === CURLY_DOUBLE_OPEN ||
      char === CURLY_DOUBLE_CLOSE
    ) {
      type = "double";
      isQuoteChar = true;
    } else if (
      char === STRAIGHT_SINGLE ||
      char === CURLY_SINGLE_OPEN ||
      char === CURLY_SINGLE_CLOSE
    ) {
      type = "single";
      isQuoteChar = true;
    }

    if (!isQuoteChar || type === null) continue;

    // Skip apostrophes
    if (type === "single" && isApostrophe(text, i)) {
      tokens.push({ index: i, char, type, role: "apostrophe" });
      continue;
    }

    // Skip decade abbreviations
    if (type === "single" && isDecadeAbbreviation(text, i)) {
      tokens.push({ index: i, char, type, role: "apostrophe" });
      continue;
    }

    // Skip primes
    if (isPrime(text, i)) {
      tokens.push({ index: i, char, type, role: "prime" });
      continue;
    }

    // Classify as OPEN or CLOSE
    const role = classifyQuote(text, i, type, doubleStack, singleStack);

    // Update stacks for classification of subsequent quotes
    if (role === "open") {
      (type === "double" ? doubleStack : singleStack).push(i);
    } else if (role === "close") {
      const stack = type === "double" ? doubleStack : singleStack;
      if (stack.length > 0) {
        stack.pop();
      }
    }

    tokens.push({ index: i, char, type, role });
  }

  return tokens;
}

/**
 * Pair quote tokens using stack-based algorithm
 */
export function pairQuotes(text: string, tokens: QuoteToken[]): PairingResult {
  const pairs: QuotePair[] = [];
  const orphans: QuoteToken[] = [];
  const doubleStack: QuoteToken[] = [];
  const singleStack: QuoteToken[] = [];

  for (const token of tokens) {
    // Skip non-quote tokens
    if (token.role === "apostrophe" || token.role === "prime") {
      continue;
    }

    const stack = token.type === "double" ? doubleStack : singleStack;

    if (token.role === "open") {
      stack.push(token);
    } else if (token.role === "close") {
      if (stack.length > 0) {
        const opener = stack.pop()!;

        // Check for orphaned inner quotes when outer closes
        // (cleanup quotes that started inside this pair but weren't closed)
        const innerStack = token.type === "double" ? singleStack : doubleStack;
        while (
          innerStack.length > 0 &&
          innerStack[innerStack.length - 1].index > opener.index
        ) {
          orphans.push(innerStack.pop()!);
        }

        pairs.push({
          openIndex: opener.index,
          closeIndex: token.index,
          type: token.type,
          content: text.slice(opener.index + 1, token.index),
          isCJKInvolved: checkCJKInvolvement(text, opener.index, token.index),
        });
      } else {
        orphans.push(token);
      }
    }
  }

  // Remaining unclosed openers are orphans
  orphans.push(...doubleStack, ...singleStack);

  // Sort pairs by opening position
  pairs.sort((a, b) => a.openIndex - b.openIndex);

  return { pairs, orphans };
}

/**
 * Main entry point: tokenize and pair quotes
 */
export function analyzeQuotes(text: string): PairingResult {
  const tokens = tokenizeQuotes(text);
  return pairQuotes(text, tokens);
}

/**
 * Apply contextual quote conversion
 *
 * @param text The text to process
 * @param mode Quote conversion mode
 * @returns Text with quotes converted according to mode
 */
export function applyContextualQuotes(
  text: string,
  mode: "off" | "curly-everywhere" | "contextual" | "corner-for-cjk"
): string {
  if (mode === "off") {
    return text;
  }

  const { pairs } = analyzeQuotes(text);

  // Build replacement map
  const replacements = new Map<number, string>();

  for (const pair of pairs) {
    let openQuote: string;
    let closeQuote: string;

    if (mode === "curly-everywhere") {
      openQuote = pair.type === "double" ? CURLY_DOUBLE_OPEN : CURLY_SINGLE_OPEN;
      closeQuote = pair.type === "double" ? CURLY_DOUBLE_CLOSE : CURLY_SINGLE_CLOSE;
    } else if (mode === "contextual") {
      if (pair.isCJKInvolved) {
        openQuote = pair.type === "double" ? CURLY_DOUBLE_OPEN : CURLY_SINGLE_OPEN;
        closeQuote = pair.type === "double" ? CURLY_DOUBLE_CLOSE : CURLY_SINGLE_CLOSE;
      } else {
        // Keep straight quotes for pure Latin
        openQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
        closeQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
      }
    } else if (mode === "corner-for-cjk") {
      if (pair.isCJKInvolved) {
        openQuote = pair.type === "double" ? CORNER_DOUBLE_OPEN : CORNER_SINGLE_OPEN;
        closeQuote = pair.type === "double" ? CORNER_DOUBLE_CLOSE : CORNER_SINGLE_CLOSE;
      } else {
        openQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
        closeQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
      }
    } else {
      continue;
    }

    replacements.set(pair.openIndex, openQuote);
    replacements.set(pair.closeIndex, closeQuote);
  }

  // Apply replacements
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (replacements.has(i)) {
      result += replacements.get(i);
    } else {
      result += text[i];
    }
  }

  return result;
}
