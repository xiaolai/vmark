/**
 * Stack-based Quote Pairing Algorithm
 *
 * Purpose: Pairs opening and closing quotes using a stack-based approach,
 * distinguishing actual quotes from apostrophes (don't), primes (5'10"),
 * and decade abbreviations ('90s). Supports contextual conversion where
 * CJK-adjacent quotes become corner brackets while Latin quotes stay straight.
 *
 * Key decisions:
 *   - Stack-based (not regex): correctly handles nested quotes, which regex
 *     approaches cannot reliably pair
 *   - Character-level classification (apostrophes, primes, decades, roles)
 *     lives in quoteClassification.ts; this file owns pairing and conversion
 *   - CJK involvement check: inspects content AND boundary characters to decide
 *     whether a pair should use CJK-style glyphs; boundary checks skip
 *     spaces/tabs so the decision is stable under the spacing the pipeline
 *     itself inserts (idempotence)
 *   - Corner brackets 「」『』 tokenize as fixed-role quotes when
 *     `cornerBracketsAsQuotes` is set (applyContextualQuotes does; quoteToggle
 *     must not — it matches corners itself), and are never replaced —
 *     re-formatting corner-converted output must see the same pairing topology
 *   - Orphan cleanup: when an outer quote closes, any unclosed inner quotes of
 *     the opposite type are moved to the orphan list
 *   - Four conversion modes: off, curly-everywhere, contextual (CJK=curly,
 *     Latin=straight), corner-for-cjk (CJK=corner brackets, Latin=straight)
 *
 * Spec Reference: Rule 6, Section 6.1 of cjk-typography-rules-draft.md
 *
 * @coordinates-with rules.ts — applyContextualQuotes called from applyRules when smartQuoteConversion enabled
 * @coordinates-with latinSpanScanner.ts — isCJKLetter used for boundary detection
 * @coordinates-with quoteClassification.ts — quote glyph constants and per-character role classification
 * @module lib/cjkFormatter/quotePairing
 */

import { isCJKLetter } from "./latinSpanScanner";
import {
  STRAIGHT_DOUBLE,
  STRAIGHT_SINGLE,
  CURLY_DOUBLE_OPEN,
  CURLY_DOUBLE_CLOSE,
  CURLY_SINGLE_OPEN,
  CURLY_SINGLE_CLOSE,
  CORNER_DOUBLE_OPEN,
  CORNER_DOUBLE_CLOSE,
  CORNER_SINGLE_OPEN,
  CORNER_SINGLE_CLOSE,
  CORNER_QUOTE_ROLES,
  classifyQuote,
  isApostrophe,
  isDecadeAbbreviation,
  isPrime,
  type QuoteType,
  type QuoteRole,
} from "./quoteClassification";

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

interface QuotePair {
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
 * Check if a span involves CJK context
 * - Content contains CJK letters, OR
 * - Left boundary touches CJK, OR
 * - Right boundary touches CJK
 *
 * Boundary checks skip spaces/tabs (never newlines): the pipeline's own
 * spacing rules insert spaces between quote glyphs and CJK text AFTER the
 * quote decision was made, so a decision based on the immediate character
 * flips on the next formatting pass (''中0 → ‘’ 中 0 → '' 中 0). Whitespace
 * must be transparent here for the conversion to be idempotent under the
 * formatter's own output.
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

  // Check left boundary (nearest non-space char before the opening quote)
  for (let i = openIndex - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === " " || ch === "\t") continue;
    if (isCJKLetter(ch)) return true;
    break;
  }

  // Check right boundary (nearest non-space char after the closing quote)
  for (let i = closeIndex + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || ch === "\t") continue;
    if (isCJKLetter(ch)) return true;
    break;
  }

  return false;
}

/** Options for tokenizeQuotes / analyzeQuotes. */
export interface TokenizeOptions {
  /**
   * Treat corner brackets 「」『』 as quote tokens with fixed open/close roles.
   *
   * Used by applyContextualQuotes so a re-format sees the same pairing
   * topology it produced: after corner-for-cjk converts "…" to 「…」, a second
   * pass that cannot see the corners loses that pair's orphan-absorbing
   * effect, and singles it had absorbed suddenly pair with each other and get
   * converted (’ became 『 on the second pass). Corner glyphs are only ever
   * PAIRED, never replaced.
   *
   * Off by default: quoteToggle.ts runs its own corner/guillemet matcher on
   * top of analyzeQuotes and would see duplicate pairs otherwise.
   */
  cornerBracketsAsQuotes?: boolean;
}

/**
 * Tokenize quotes in text, filtering out apostrophes and primes
 */
export function tokenizeQuotes(
  text: string,
  options: TokenizeOptions = {}
): QuoteToken[] {
  const tokens: QuoteToken[] = [];
  const doubleStack: number[] = [];
  const singleStack: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    let type: QuoteType | null = null;
    let isQuoteChar = false;

    // Corner brackets: unambiguous roles, no classification needed.
    if (options.cornerBracketsAsQuotes && char in CORNER_QUOTE_ROLES) {
      const [cornerType, cornerRole] = CORNER_QUOTE_ROLES[char];
      if (cornerRole === "open") {
        (cornerType === "double" ? doubleStack : singleStack).push(i);
      } else {
        const stack = cornerType === "double" ? doubleStack : singleStack;
        if (stack.length > 0) {
          stack.pop();
        }
      }
      tokens.push({ index: i, char, type: cornerType, role: cornerRole });
      continue;
    }

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
    // (classifyQuote only returns "open" or "close" — no other role reaches here)
    if (role === "open") {
      (type === "double" ? doubleStack : singleStack).push(i);
    } else {
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
function pairQuotes(text: string, tokens: QuoteToken[]): PairingResult {
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

    // (tokens here only have "open" or "close" roles after apostrophe/prime filtering)
    if (token.role === "open") {
      stack.push(token);
    } else {
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
export function analyzeQuotes(
  text: string,
  options: TokenizeOptions = {}
): PairingResult {
  const tokens = tokenizeQuotes(text, options);
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

  // Corner-aware pairing keeps the topology stable when this function's own
  // output (corner-for-cjk) is formatted again — see TokenizeOptions.
  const { pairs } = analyzeQuotes(text, { cornerBracketsAsQuotes: true });

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

    // Never rewrite a corner glyph: user-authored 「」『』 stay as written
    // (matching the pre-corner-aware behavior, where they were invisible to
    // pairing and therefore untouched).
    if (!(text[pair.openIndex] in CORNER_QUOTE_ROLES)) {
      replacements.set(pair.openIndex, openQuote);
    }
    if (!(text[pair.closeIndex] in CORNER_QUOTE_ROLES)) {
      replacements.set(pair.closeIndex, closeQuote);
    }
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
