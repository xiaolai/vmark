/**
 * Group 4 — Dash and quote conversion / spacing rules.
 *
 * @coordinates-with quotePairing — stack-based contextual quote conversion
 * @coordinates-with quoteClassification — the quote characters
 * @coordinates-with paragraphBreaks — quotes pair inside one paragraph
 * @module lib/cjkFormatter/rules/dashesQuotes
 */

import type { QuoteStyle } from "@/stores/settingsStore";
import { CURLY_SINGLE_CLOSE, CURLY_SINGLE_OPEN } from "../quoteClassification";
import { perParagraph } from "../paragraphBreaks";
import {
  CJK_LETTER_CLASS,
  CJK_CHARS_PATTERN,
  CJK_CLOSING_BRACKETS,
  CJK_OPENING_BRACKETS,
  CJK_TERMINAL_PUNCTUATION,
  HAN_CLASS,
  LATIN_ALNUM,
  codePointAt,
  codePointBefore,
  isCJKLetter,
  isHangulLetter,
  replaceDelimited,
} from "./shared";

/**
 * Convert dashes (2+) to —— when adjacent to CJK characters.
 * Matches: CJK--CJK, CJK--word, word--CJK.
 *
 * Same-line only ([ \t], never \n): dashes at a line boundary — e.g. a setext
 * H2 underline ("--" under a heading) — must not join adjacent lines.
 */
export function convertDashes(text: string): string {
  // CJK on both sides
  const cjkBothPattern = new RegExp(
    `(${CJK_CHARS_PATTERN})[ \\t]*-{2,}[ \\t]*(${CJK_CHARS_PATTERN})`,
    "gu"
  );
  // CJK on left, alphanumeric on right
  const cjkLeftPattern = new RegExp(
    `(${CJK_CHARS_PATTERN})[ \\t]*-{2,}[ \\t]*(${LATIN_ALNUM})`,
    "gu"
  );
  // Alphanumeric on left, CJK on right
  const cjkRightPattern = new RegExp(
    `(${LATIN_ALNUM})[ \\t]*-{2,}[ \\t]*(${CJK_CHARS_PATTERN})`,
    "gu"
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

/**
 * Fix spacing around existing —— (em-dash) characters.
 * Same-line only ([ \t], never \n): a —— at a line boundary must not pull
 * the next line up.
 */
export function fixEmdashSpacing(text: string): string {
  return text.replace(/([^\s])[ \t]*——[ \t]*([^\s])/gu, (_, before, after) => {
    // No space between closing brackets/quotes and ——
    const leftSpace = CJK_CLOSING_BRACKETS.includes(before) ? "" : " ";
    // No space between —— and opening brackets/quotes
    const rightSpace = CJK_OPENING_BRACKETS.includes(after) ? "" : " ";
    return `${before}${leftSpace}——${rightSpace}${after}`;
  });
}

/**
 * Fix spacing around quotation marks (generic).
 *
 * A CJK letter beside a curly quote IS spaced, as is a Latin one. The two
 * settings that call this (`quoteSpacing`, `singleQuoteSpacing`) are labelled
 * as spacing "around “”"; a rule that exempted CJK left the switch on and the
 * text unchanged, which is the defect this shape avoids — the setting, not the
 * rule, decides.
 *
 * The typographic argument for the exemption still holds for anyone who wants
 * it: `“ ”` are fullwidth in CJK context, and GB/T 15834, JLREQ and the W3C's
 * *Spacing between scripts inline* all treat the gap as part of the glyph.
 * That argument is now the OFF position of the setting rather than a hard-coded
 * exemption.
 *
 * Brackets and terminal punctuation still take no space (the glyph supplies
 * it), and corner quotes `「」` are never spaced — `applyRules` does not call
 * them for that. Korean is outside `CJK_LETTER_CLASS`, so it is unchanged.
 */
function fixQuoteSpacing(
  text: string,
  openingQuote: string,
  closingQuote: string,
  /**
   * Whether a CJK letter beside the quote takes a space. True for the curly
   * quotes the two settings govern; false for `「」`, which are fullwidth
   * brackets that `applyRules` never asks this rule about.
   */
  spaceBesideCJK: boolean
): string {
  const noSpaceBefore = CJK_CLOSING_BRACKETS + CJK_TERMINAL_PUNCTUATION;
  const noSpaceAfter = CJK_OPENING_BRACKETS + CJK_TERMINAL_PUNCTUATION;

  // Add space before opening quote if preceded by alphanumeric/CJK
  text = text.replace(
    new RegExp(
      `(${LATIN_ALNUM}|[${CJK_LETTER_CLASS}${CJK_CLOSING_BRACKETS}${CJK_TERMINAL_PUNCTUATION}]|——)${openingQuote}`,
      "gu"
    ),
    (_, before) => {
      if (noSpaceBefore.includes(before) || (!spaceBesideCJK && isCJKLetter(before))) {
        return `${before}${openingQuote}`;
      }
      return `${before} ${openingQuote}`;
    }
  );

  // Add space after closing quote if followed by alphanumeric/CJK
  text = text.replace(
    new RegExp(
      `${closingQuote}(${LATIN_ALNUM}|[${CJK_LETTER_CLASS}${CJK_OPENING_BRACKETS}${CJK_TERMINAL_PUNCTUATION}]|——)`,
      "gu"
    ),
    (_, after) => {
      if (noSpaceAfter.includes(after) || (!spaceBesideCJK && isCJKLetter(after))) {
        return `${closingQuote}${after}`;
      }
      return `${closingQuote} ${after}`;
    }
  );

  return text;
}

/** Fix spacing around double quotes "". */
export function fixDoubleQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "\u201c", "\u201d", true);
}

/** Fix spacing around single quotes ''. */
export function fixSingleQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "\u2018", "\u2019", true);
}

/** Fix spacing around CJK corner quotes 「」. */
export function fixCornerQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "「", "」", false);
}

/** Fix spacing around CJK double corner quotes 『』. */
export function fixDoubleCornerQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "『", "』", false);
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
 *
 * Each paragraph is converted on its own: a pair never spans a paragraph
 * break, and the open/close parity next to CJK restarts in each one.
 */
export function convertStraightToSmartQuotes(text: string, style: QuoteStyle): string {
  return perParagraph(text, (paragraph) => convertParagraphQuotes(paragraph, style));
}

/** `convertStraightToSmartQuotes` within one paragraph. */
function convertParagraphQuotes(text: string, style: QuoteStyle): string {
  const quotes = QUOTE_STYLES[style];
  // Quote parity is tracked next to any CJK script, Korean included.
  const isCJKContext = (ch: string): boolean => isCJKLetter(ch) || isHangulLetter(ch);

  // Track quote parity for CJK context (odd=opening, even=closing)
  let cjkQuoteCount = 0;

  // Convert double quotes "
  // Opening: after whitespace, start of line/string, or opening brackets
  // Closing: after word characters, punctuation, or before whitespace/end
  text = text.replace(/"/g, (_, offset) => {
    // Whole code points: a supplementary-plane Han neighbour is one character.
    const before = codePointBefore(text, offset);
    const after = codePointAt(text, offset + 1);

    // Opening quote: at start, after whitespace, or after opening brackets
    if (offset === 0 || /[\s([{「『《【〈]/.test(before)) {
      return quotes.doubleOpen;
    }
    // CJK before quote: use parity tracking and context hints
    if (isCJKContext(before)) {
      cjkQuoteCount++;
      // Odd count = opening, even count = closing
      // But also check context: if followed by punctuation/end, definitely closing
      if (!/[\s\w]/.test(after) && !isCJKContext(after)) {
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
    new RegExp(`([${CJK_LETTER_CLASS}])'([^']*?)'`, "gu"),
    (_, before, content) => `${before}${quotes.singleOpen}${content}${quotes.singleClose}`
  );

  // Remaining single quotes are likely apostrophes - leave them as-is
  // (e.g., don't, it's, '90s)

  return text;
}

/**
 * Convert curly double quotes to CJK corner quotes when quoting CJK text.
 * "中文内容" → 「中文内容」. A pair never spans a paragraph break.
 */
export function convertToCJKCornerQuotes(text: string): string {
  // Match "content" where content contains CJK
  return perParagraph(text, (paragraph) => paragraph.replace(
    new RegExp(`\u201c([^\u201d]*[${HAN_CLASS}][^\u201d]*)\u201d`, "gu"),
    "「$1」"
  ));
}

/**
 * Convert nested single quotes to corner brackets inside corner quotes.
 * 「text 'nested' text」 → 「text『nested』text」. Neither pair spans a
 * paragraph break.
 */
export function convertNestedCornerQuotes(text: string): string {
  // Only convert single quotes inside corner quotes
  return perParagraph(text, (paragraph) =>
    replaceDelimited(
      paragraph,
      "「",
      "」",
      (content) =>
        `「${replaceDelimited(content, CURLY_SINGLE_OPEN, CURLY_SINGLE_CLOSE, (inner) => `『${inner}』`)}」`
    )
  );
}
