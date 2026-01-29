/**
 * CJK Text Formatting Rules
 * Ported from Python cjk-text-formatter project
 */

import type { CJKFormattingSettings, QuoteStyle } from "@/stores/settingsStore";
import {
  scanLatinSpans,
  isInTechnicalSubspan,
  isCJKLetter,
} from "./latinSpanScanner";
import { applyContextualQuotes } from "./quotePairing";

// Character ranges - Extended CJK coverage
const HAN_BASIC = "\u4e00-\u9fff"; // CJK Unified Ideographs (basic block)
const HAN_EXT_A = "\u3400-\u4dbf"; // CJK Extension A (rare characters)
// Note: Extensions B-G (U+20000-U+2CEAF) are beyond BMP, require surrogate pairs
const BOPOMOFO = "\u3100-\u312f"; // Bopomofo (Zhuyin)
const BOPOMOFO_EXT = "\u31a0-\u31bf"; // Bopomofo Extended
const HIRAGANA = "\u3040-\u309f";
const KATAKANA = "\u30a0-\u30ff";
const KATAKANA_EXT = "\u31f0-\u31ff"; // Katakana Phonetic Extensions
const HANGUL = "\uac00-\ud7af"; // Hangul Syllables
const HANGUL_JAMO = "\u1100-\u11ff"; // Hangul Jamo (combining)
const HANGUL_COMPAT = "\u3130-\u318f"; // Hangul Compatibility Jamo
// Combined ranges
const HAN = `${HAN_BASIC}${HAN_EXT_A}`;
const CJK_ALL = `${HAN}${BOPOMOFO}${BOPOMOFO_EXT}${HIRAGANA}${KATAKANA}${KATAKANA_EXT}${HANGUL}${HANGUL_JAMO}${HANGUL_COMPAT}`;
const CJK_NO_KOREAN = `${HAN}${BOPOMOFO}${BOPOMOFO_EXT}${HIRAGANA}${KATAKANA}${KATAKANA_EXT}`;

// CJK punctuation
const CJK_TERMINAL_PUNCTUATION = "，。！？；：、";
const CJK_CLOSING_BRACKETS = "》」』】）〉";
const CJK_OPENING_BRACKETS = "《「『【（〈";

// Character class patterns
const CJK_CHARS_PATTERN = `[${HAN}${HIRAGANA}${KATAKANA}《》「」『』【】（）〈〉，。！？；：、]`;

// Punctuation conversion map (half-width → full-width)
const PUNCTUATION_MAP: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ";": "；",
  ":": "：",
};

/**
 * Get the nearest non-space character to the left
 */
function getLeftNeighbor(text: string, pos: number): string {
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] !== " " && text[i] !== "\t") {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      // Combine surrogate pair if we landed on a low surrogate.
      if (code >= 0xdc00 && code <= 0xdfff && i - 1 >= 0) {
        const prev = text[i - 1];
        const prevCode = prev.charCodeAt(0);
        if (prevCode >= 0xd800 && prevCode <= 0xdbff) {
          return prev + ch;
        }
      }
      return ch;
    }
  }
  return "";
}

/**
 * Get the nearest non-space character to the right
 */
function getRightNeighbor(text: string, pos: number): string {
  for (let i = pos + 1; i < text.length; i++) {
    if (text[i] !== " " && text[i] !== "\t") {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      // Combine surrogate pair if we landed on a high surrogate.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const next = text[i + 1];
        const nextCode = next.charCodeAt(0);
        if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
          return ch + next;
        }
      }
      return ch;
    }
  }
  return "";
}

/**
 * Check if text contains CJK characters (Han, Kana, or Hangul)
 * Uses Unicode script property escapes for full coverage including supplementary planes
 */
export function containsCJK(text: string): boolean {
  // Use Unicode script properties for comprehensive coverage
  // This handles Han (including Extensions B-G), Hiragana, Katakana, Hangul, Bopomofo
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Bopomofo}/u.test(
    text
  );
}

// ============================================================
// Group 1: Universal Rules
// ============================================================

/**
 * Normalize spaced ellipsis patterns to standard ellipsis
 * e.g., ". . ." → "..."
 */
export function normalizeEllipsis(text: string): string {
  // Replace spaced dots with standard ellipsis
  text = text.replace(/\s*\.\s+\.\s+\.(?:\s+\.)*/g, "...");
  // Ensure exactly one space after ellipsis when followed by non-whitespace
  text = text.replace(/\.\.\.\s*(?=\S)/g, "... ");
  return text;
}

/**
 * Collapse excessive newlines (3+) to max 2
 * Also handles legacy <br /> tags for empty paragraphs
 */
export function collapseNewlines(text: string): string {
  // Remove standalone <br /> lines (empty paragraphs from legacy WYSIWYG output)
  // Pattern: \n\n<br />\n\n or multiple consecutive ones
  text = text.replace(/(\n\n)(<br\s*\/?>\n\n)+/g, "\n\n");

  // Also handle <br /> at start after first paragraph
  text = text.replace(/\n\n<br\s*\/?>\n\n/g, "\n\n");

  // Collapse 3+ consecutive newlines to exactly 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text;
}

// ============================================================
// Group 2: Fullwidth Normalization
// ============================================================

/**
 * Convert full-width alphanumeric to half-width
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
 * Check if a character is part of an ellipsis pattern
 */
function isPartOfEllipsis(text: string, pos: number): boolean {
  // Check if this period is part of "..." or surrounded by other periods
  if (text[pos] !== ".") return false;

  const before = pos > 0 ? text[pos - 1] : "";
  const after = pos < text.length - 1 ? text[pos + 1] : "";

  return before === "." || after === ".";
}

/**
 * Normalize punctuation width based on CJK context
 *
 * Converts ASCII punctuation to fullwidth when in CJK context.
 * Protects punctuation inside technical subspans (URLs, versions, etc.)
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

    // Special case: ellipsis - never convert periods that are part of ...
    if (char === "." && isPartOfEllipsis(text, i)) {
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

/**
 * Convert half-width parentheses to full-width when content is CJK
 */
export function normalizeFullwidthParentheses(text: string): string {
  return text.replace(
    new RegExp(`\\(([${CJK_NO_KOREAN}][^()]*)\\)`, "g"),
    "（$1）"
  );
}

/**
 * Convert half-width brackets to full-width when content is CJK
 */
export function normalizeFullwidthBrackets(text: string): string {
  return text.replace(
    new RegExp(`\\[([${CJK_NO_KOREAN}][^\\[\\]]*)\\]`, "g"),
    "【$1】"
  );
}

// ============================================================
// Group 3: Spacing Rules
// ============================================================

/**
 * Add spaces between CJK characters and English/numbers
 */
export function addCJKEnglishSpacing(text: string): string {
  // Pattern for alphanumeric with optional units
  const alphanumPattern =
    "(?:[$¥€£₹][ ]?)?[A-Za-z0-9]+(?:[%‰℃℉]|°[CcFf]?|[ ]?(?:USD|CNY|EUR|GBP|RMB))?";

  // CJK followed by alphanumeric
  text = text.replace(
    new RegExp(`([${CJK_ALL}])(${alphanumPattern})`, "g"),
    "$1 $2"
  );
  // Alphanumeric followed by CJK
  text = text.replace(
    new RegExp(`(${alphanumPattern})([${CJK_ALL}])`, "g"),
    "$1 $2"
  );

  return text;
}

/**
 * Add space between CJK characters and half-width parentheses
 */
export function addCJKParenthesisSpacing(text: string): string {
  // Add space between CJK character and opening paren
  text = text.replace(new RegExp(`([${CJK_ALL}])\\(`, "g"), "$1 (");
  // Add space between closing paren and CJK character
  text = text.replace(new RegExp(`\\)([${CJK_ALL}])`, "g"), ") $1");
  return text;
}

/**
 * Currency and unit binding
 *
 * - Prefix currency symbols ($, ¥, €, £, ₹) bind tight to following number: `$ 100` → `$100`
 * - Unit symbols (%, ‰, ℃, ℉, °) bind tight to preceding number: `50 %` → `50%`
 * - Postfix currency codes (USD, CNY, EUR, GBP, RMB) are spaced from preceding number: `100USD` → `100 USD`
 */
export function fixCurrencySpacing(
  text: string,
  postfixCurrency: "tight" | "spaced" = "spaced"
): string {
  // Prefix currency symbols bind tight to following number
  text = text.replace(/([$¥€£₹])\s+(\d)/g, "$1$2");

  // Prefix currency codes bind tight to following number (style choice: keep tight)
  text = text.replace(/(USD|CNY|EUR|GBP|RMB|JPY)\s+(\d)/g, "$1$2");

  // Unit symbols bind tight to preceding number
  // Note: No word boundary assertion since these are Unicode symbols
  text = text.replace(/(\d)\s+(%|‰|℃|℉|°[CcFf]?)(?=[\s,;.。，；、！？!?)\]」』】〉》)]|$)/g, "$1$2");

  // Postfix currency codes: space or tight based on setting
  if (postfixCurrency === "spaced") {
    // Add space between number and postfix currency code if missing
    text = text.replace(/(\d)(USD|CNY|EUR|GBP|RMB|JPY)\b/g, "$1 $2");
  } else {
    // Remove space between number and postfix currency code
    text = text.replace(/(\d)\s+(USD|CNY|EUR|GBP|RMB|JPY)\b/g, "$1$2");
  }

  return text;
}

/**
 * Remove spaces around slashes (preserves URLs)
 */
export function fixSlashSpacing(text: string): string {
  // Remove spaces around / but not in URLs (avoid //)
  return text.replace(/(?<![/:])\s*\/\s*(?!\/)/g, "/");
}

/**
 * Collapse multiple spaces to single space (preserves indentation)
 */
export function collapseSpaces(text: string): string {
  // Match non-space + 2+ spaces to preserve leading indentation
  return text.replace(/(\S) {2,}/g, "$1 ");
}

// ============================================================
// Group 4: Dash & Quote Rules
// ============================================================

/**
 * Convert dashes (2+) to —— when adjacent to CJK characters
 * Matches: CJK--CJK, CJK--word, word--CJK
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

/**
 * Fix spacing around existing —— (em-dash) characters
 */
export function fixEmdashSpacing(text: string): string {
  return text.replace(/([^\s])\s*——\s*([^\s])/g, (_, before, after) => {
    // No space between closing brackets/quotes and ——
    const leftSpace = CJK_CLOSING_BRACKETS.includes(before) ? "" : " ";
    // No space between —— and opening brackets/quotes
    const rightSpace = CJK_OPENING_BRACKETS.includes(after) ? "" : " ";
    return `${before}${leftSpace}——${rightSpace}${after}`;
  });
}

/**
 * Fix spacing around quotation marks (generic)
 */
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
      `([A-Za-z0-9${CJK_ALL}${CJK_CLOSING_BRACKETS}${CJK_TERMINAL_PUNCTUATION}]|——)${openingQuote}`,
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
      `${closingQuote}([A-Za-z0-9${CJK_ALL}${CJK_OPENING_BRACKETS}${CJK_TERMINAL_PUNCTUATION}]|——)`,
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

/**
 * Fix spacing around double quotes ""
 */
export function fixDoubleQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "\u201c", "\u201d");
}

/**
 * Fix spacing around single quotes ''
 */
export function fixSingleQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "\u2018", "\u2019");
}

/**
 * Fix spacing around CJK corner quotes 「」
 */
export function fixCornerQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "「", "」");
}

/**
 * Fix spacing around CJK double corner quotes 『』
 */
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

  // Convert double quotes "
  // Opening: after whitespace, start of line/string, or opening brackets
  // Closing: after word characters, punctuation, or before whitespace/end
  text = text.replace(/"/g, (_, offset) => {
    const before = offset > 0 ? text[offset - 1] : "";
    // Opening quote: at start, after whitespace, or after opening brackets
    if (offset === 0 || /[\s([{「『《【〈]/.test(before)) {
      return quotes.doubleOpen;
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

  // Remaining single quotes are likely apostrophes - leave them as-is
  // (e.g., don't, it's, '90s)

  return text;
}

/**
 * Convert curly double quotes to CJK corner quotes when quoting CJK text
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
 * Convert nested single quotes to corner brackets inside corner quotes
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

// ============================================================
// Group 5: Cleanup Rules
// ============================================================

/**
 * Limit consecutive punctuation marks
 */
export function limitConsecutivePunctuation(
  text: string,
  limit: number
): string {
  if (limit === 0) return text;

  const marks = ["！", "？", "。"];
  for (const mark of marks) {
    const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (limit === 1) {
      text = text.replace(new RegExp(`${escaped}{2,}`, "g"), mark);
    } else if (limit === 2) {
      text = text.replace(new RegExp(`${escaped}{3,}`, "g"), mark + mark);
    }
  }
  return text;
}

/**
 * Remove trailing spaces at end of lines
 */
export function removeTrailingSpaces(
  text: string,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): string {
  if (!options.preserveTwoSpaceHardBreaks) {
    return text.replace(/ +$/gm, "");
  }

  const lines = text.split("\n");
  const processed = lines.map((line) => {
    let lineEnding = "";
    let content = line;

    if (content.endsWith("\r")) {
      lineEnding = "\r";
      content = content.slice(0, -1);
    }

    const trailingMatch = content.match(/ +$/);
    if (!trailingMatch) return content + lineEnding;

    const trailingSpaces = trailingMatch[0];
    const before = content.slice(0, -trailingSpaces.length);

    if (trailingSpaces.length >= 2 && before.trim().length > 0) {
      return content + lineEnding;
    }

    return before + lineEnding;
  });

  return processed.join("\n");
}

// ============================================================
// Main Apply Function
// ============================================================

/**
 * Apply all enabled CJK formatting rules to text
 */
export function applyRules(
  text: string,
  config: CJKFormattingSettings,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): string {
  // Group 1: Universal (always check, applies to all text)
  if (config.ellipsisNormalization) {
    text = normalizeEllipsis(text);
  }

  // Check if text contains CJK - most rules only apply to CJK text
  if (containsCJK(text)) {
    // Group 2: Fullwidth Normalization (run first)
    if (config.fullwidthAlphanumeric) {
      text = normalizeFullwidthAlphanumeric(text);
    }
    if (config.fullwidthPunctuation) {
      text = normalizeFullwidthPunctuation(text);
    }
    if (config.fullwidthBrackets) {
      text = normalizeFullwidthBrackets(text);
    }

    // Group 4: Dash & Quote (before spacing rules)
    if (config.dashConversion) {
      text = convertDashes(text);
    }
    if (config.emdashSpacing) {
      text = fixEmdashSpacing(text);
    }

    // Smart quote conversion using stack-based pairing algorithm
    // Handles apostrophes, primes, and CJK context detection
    if (config.smartQuoteConversion) {
      if (config.quoteStyle === "curly" || config.quoteStyle === "corner") {
        // Use new stack-based algorithm for curly/corner styles
        // Mode selection:
        // - "contextual": curly for CJK context, straight for pure Latin (recommended)
        // - "corner-for-cjk": corner quotes for CJK context, straight for Latin
        // - "curly-everywhere": curly quotes everywhere
        let mode: "off" | "curly-everywhere" | "contextual" | "corner-for-cjk";
        if (config.cjkCornerQuotes) {
          mode = "corner-for-cjk";
        } else if (config.contextualQuotes) {
          mode = "contextual";
        } else {
          mode = "curly-everywhere";
        }
        text = applyContextualQuotes(text, mode);
      } else {
        // Fall back to regex-based conversion for guillemets and other styles
        text = convertStraightToSmartQuotes(text, config.quoteStyle);
      }
    }

    // Nested corner quotes: 「outer『inner』outer」
    if (config.cjkNestedQuotes) {
      text = convertNestedCornerQuotes(text);
    }

    if (config.quoteSpacing) {
      text = fixDoubleQuoteSpacing(text);
      // Note: CJK corner quotes 「」『』 do NOT need spacing - they follow
      // Chinese typography rules where fullwidth brackets have no surrounding spaces
    }
    if (config.singleQuoteSpacing) {
      text = fixSingleQuoteSpacing(text);
    }

    // Group 3: Spacing
    if (config.cjkEnglishSpacing) {
      text = addCJKEnglishSpacing(text);
    }
    // Note: cjk_parenthesis_spacing must run BEFORE fullwidth_parentheses
    if (config.cjkParenthesisSpacing) {
      text = addCJKParenthesisSpacing(text);
    }
    // Now convert remaining () to （） in CJK context
    if (config.fullwidthParentheses) {
      text = normalizeFullwidthParentheses(text);
    }
    if (config.currencySpacing) {
      text = fixCurrencySpacing(text);
    }
    if (config.slashSpacing) {
      text = fixSlashSpacing(text);
    }

    // Group 5: Cleanup (CJK-specific)
    if (config.consecutivePunctuationLimit > 0) {
      text = limitConsecutivePunctuation(
        text,
        config.consecutivePunctuationLimit
      );
    }
  }

  // Group 5: Universal cleanup rules (apply to all text)
  if (config.spaceCollapsing) {
    text = collapseSpaces(text);
  }
  if (config.trailingSpaceRemoval) {
    text = removeTrailingSpaces(text, options);
  }

  // Group 1: Universal (newline collapsing)
  if (config.newlineCollapsing) {
    text = collapseNewlines(text);
  }

  // Remove trailing whitespace and markdown hard line breaks (\\)
  return text.trimEnd().replace(/\\+$/, "");
}
