/**
 * Group 4 — Dash and quote conversion / spacing rules.
 *
 * @coordinates-with quotePairing — stack-based contextual quote conversion
 * @module lib/cjkFormatter/rules/dashesQuotes
 */

import type { QuoteStyle } from "@/stores/settingsStore";
import {
  CJK_NO_KOREAN,
  CJK_CHARS_PATTERN,
  CJK_CLOSING_BRACKETS,
  CJK_OPENING_BRACKETS,
  CJK_TERMINAL_PUNCTUATION,
} from "./shared";

/**
 * Convert dashes (2+) to —— when adjacent to CJK characters.
 * Matches: CJK--CJK, CJK--word, word--CJK.
 */
export function convertDashes(text: string): string {
  // CJK on both sides
  const cjkBothPattern = new RegExp(
    `(${CJK_CHARS_PATTERN})\\s*-{2,}\\s*(${CJK_CHARS_PATTERN})`,
    "g"
  );
  // CJK on left, alphanumeric on right
  const cjkLeftPattern = new RegExp(
    `(${CJK_CHARS_PATTERN})\\s*-{2,}\\s*([A-Za-z0-9])`,
    "g"
  );
  // Alphanumeric on left, CJK on right
  const cjkRightPattern = new RegExp(
    `([A-Za-z0-9])\\s*-{2,}\\s*(${CJK_CHARS_PATTERN})`,
    "g"
  );

  const replacer = (_: string, before: string, after: string) => {
    // No space between closing brackets/quotes and ——
    const leftSpace = CJK_CLOSING_BRACKETS.includes(before) ? "" : " ";
    // No space between —— and opening brackets/quotes
    const rightSpace = CJK_OPENING_BRACKETS.includes(after) ? "" : " ";
    return `${before}${leftSpace}——${rightSpace}${after}`;
  };

  text = text.replace(cjkBothPattern, replacer);
  text = text.replace(cjkLeftPattern, replacer);
  text = text.replace(cjkRightPattern, replacer);

  return text;
}

/** Fix spacing around existing —— (em-dash) characters. */
export function fixEmdashSpacing(text: string): string {
  return text.replace(/([^\s])\s*——\s*([^\s])/g, (_, before, after) => {
    // No space between closing brackets/quotes and ——
    const leftSpace = CJK_CLOSING_BRACKETS.includes(before) ? "" : " ";
    // No space between —— and opening brackets/quotes
    const rightSpace = CJK_OPENING_BRACKETS.includes(after) ? "" : " ";
    return `${before}${leftSpace}——${rightSpace}${after}`;
  });
}

/** Fix spacing around quotation marks (generic). */
function fixQuoteSpacing(
  text: string,
  openingQuote: string,
  closingQuote: string
): string {
  const noSpaceBefore = CJK_CLOSING_BRACKETS + CJK_TERMINAL_PUNCTUATION;
  const noSpaceAfter = CJK_OPENING_BRACKETS + CJK_TERMINAL_PUNCTUATION;

  // Add space before opening quote if preceded by alphanumeric/CJK
  text = text.replace(
    new RegExp(
      `([A-Za-z0-9${CJK_NO_KOREAN}${CJK_CLOSING_BRACKETS}${CJK_TERMINAL_PUNCTUATION}]|——)${openingQuote}`,
      "g"
    ),
    (_, before) => {
      if (noSpaceBefore.includes(before)) {
        return `${before}${openingQuote}`;
      }
      return `${before} ${openingQuote}`;
    }
  );

  // Add space after closing quote if followed by alphanumeric/CJK
  text = text.replace(
    new RegExp(
      `${closingQuote}([A-Za-z0-9${CJK_NO_KOREAN}${CJK_OPENING_BRACKETS}${CJK_TERMINAL_PUNCTUATION}]|——)`,
      "g"
    ),
    (_, after) => {
      if (noSpaceAfter.includes(after)) {
        return `${closingQuote}${after}`;
      }
      return `${closingQuote} ${after}`;
    }
  );

  return text;
}

/** Fix spacing around double quotes "". */
export function fixDoubleQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "\u201c", "\u201d");
}

/** Fix spacing around single quotes ''. */
export function fixSingleQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "\u2018", "\u2019");
}

/** Fix spacing around CJK corner quotes 「」. */
export function fixCornerQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "「", "」");
}

/** Fix spacing around CJK double corner quotes 『』. */
export function fixDoubleCornerQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "『", "』");
}

// Quote style definitions
const QUOTE_STYLES: Record<QuoteStyle, {
  doubleOpen: string;
  doubleClose: string;
  singleOpen: string;
  singleClose: string;
}> = {
  curly: { doubleOpen: "\u201c", doubleClose: "\u201d", singleOpen: "\u2018", singleClose: "\u2019" }, // "" ''
  corner: { doubleOpen: "「", doubleClose: "」", singleOpen: "『", singleClose: "』" }, // 「」『』
  guillemets: { doubleOpen: "«", doubleClose: "»", singleOpen: "‹", singleClose: "›" }, // «» ‹›
};

/**
 * Convert straight quotes to smart quotes based on chosen style.
 * Uses context to determine opening vs closing quotes.
 *
 * Handles:
 * - "text" → "text" (or 「text」 or «text»)
 * - 'text' → 'text' (or 『text』 or ‹text›)
 * - Preserves apostrophes in contractions (don't, it's)
 */
export function convertStraightToSmartQuotes(text: string, style: QuoteStyle): string {
  const quotes = QUOTE_STYLES[style];
  // CJK character pattern for context checks
  const CJK_CHAR = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

  // Track quote parity for CJK context (odd=opening, even=closing)
  let cjkQuoteCount = 0;

  // Convert double quotes "
  // Opening: after whitespace, start of line/string, or opening brackets
  // Closing: after word characters, punctuation, or before whitespace/end
  text = text.replace(/"/g, (_, offset) => {
    const before = offset > 0 ? text[offset - 1] : "";
    const after = offset < text.length - 1 ? text[offset + 1] : "";

    // Opening quote: at start, after whitespace, or after opening brackets
    if (offset === 0 || /[\s([{「『《【〈]/.test(before)) {
      return quotes.doubleOpen;
    }
    // CJK before quote: use parity tracking and context hints
    if (CJK_CHAR.test(before)) {
      cjkQuoteCount++;
      // Odd count = opening, even count = closing
      // But also check context: if followed by punctuation/end, definitely closing
      if (!/[\s\w]/.test(after) && !CJK_CHAR.test(after)) {
        // Followed by punctuation or end - closing quote
        return quotes.doubleClose;
      }
      // Use parity: odd = opening, even = closing
      return cjkQuoteCount % 2 === 1 ? quotes.doubleOpen : quotes.doubleClose;
    }
    // Closing quote: everything else
    return quotes.doubleClose;
  });

  // Convert single quotes ' (but preserve apostrophes)
  // Strategy: use paired matching first, then handle remaining
  // This is tricky because ' is used for both quotes AND apostrophes

  // First, find paired single quotes: 'text'
  // A pair is: whitespace/start + ' + non-quote content + ' + whitespace/punctuation/end
  text = text.replace(
    /(^|[\s([{「『《【〈])'([^']*?)'/g,
    (_, before, content) => `${before}${quotes.singleOpen}${content}${quotes.singleClose}`
  );

  // Also handle single quotes after CJK characters
  text = text.replace(
    new RegExp(`([${CJK_NO_KOREAN}])'([^']*?)'`, "g"),
    (_, before, content) => `${before}${quotes.singleOpen}${content}${quotes.singleClose}`
  );

  // Remaining single quotes are likely apostrophes - leave them as-is
  // (e.g., don't, it's, '90s)

  return text;
}

/**
 * Convert curly double quotes to CJK corner quotes when quoting CJK text.
 * "中文内容" → 「中文内容」
 */
export function convertToCJKCornerQuotes(text: string): string {
  // Match "content" where content contains CJK
  return text.replace(
    /\u201c([^\u201d]*[\u4e00-\u9fff][^\u201d]*)\u201d/g,
    "「$1」"
  );
}

/**
 * Convert nested single quotes to corner brackets inside corner quotes.
 * 「text 'nested' text」 → 「text『nested』text」
 */
export function convertNestedCornerQuotes(text: string): string {
  // Only convert single quotes inside corner quotes
  return text.replace(/「([^」]*)」/g, (_, content) => {
    const converted = content.replace(
      /\u2018([^\u2019]*)\u2019/g,
      "『$1』"
    );
    return `「${converted}」`;
  });
}
