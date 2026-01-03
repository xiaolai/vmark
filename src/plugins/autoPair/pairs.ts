/**
 * Auto-Pair Character Definitions
 *
 * Defines opening/closing pairs for auto-completion.
 */

/** ASCII bracket and quote pairs */
export const ASCII_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};

/** CJK bracket pairs */
export const CJK_BRACKET_PAIRS: Record<string, string> = {
  "（": "）", // Fullwidth parentheses
  "【": "】", // Lenticular brackets
  "「": "」", // Corner brackets
  "『": "』", // White corner brackets
  "《": "》", // Double angle brackets
  "〈": "〉", // Angle brackets
};

/** CJK curly quote pairs
 * NOTE: May conflict with Chinese IME "smart quote" features.
 * Disabled by default - users can enable in settings.
 */
export const CJK_CURLY_QUOTE_PAIRS: Record<string, string> = {
  "\u201C": "\u201D", // Curly double quotes " "
  "\u2018": "\u2019", // Curly single quotes ' '
};

/** Combined CJK pairs (for backwards compatibility) */
export const CJK_PAIRS: Record<string, string> = {
  ...CJK_BRACKET_PAIRS,
  ...CJK_CURLY_QUOTE_PAIRS,
};

/** All closing characters (for skip-over detection) */
export const CLOSING_CHARS = new Set([
  ...Object.values(ASCII_PAIRS),
  ...Object.values(CJK_PAIRS),
]);

/** Characters that should use smart quote detection (skip after word char) */
export const SMART_QUOTE_CHARS = new Set(["'", "\u2018"]);

export interface PairConfig {
  includeCJK: boolean;
  includeCurlyQuotes: boolean;
}

/**
 * Get the closing character for an opening character
 */
export function getClosingChar(
  openChar: string,
  config: boolean | PairConfig
): string | null {
  // Support legacy boolean API
  const { includeCJK, includeCurlyQuotes } =
    typeof config === "boolean"
      ? { includeCJK: config, includeCurlyQuotes: config }
      : config;

  if (ASCII_PAIRS[openChar]) {
    return ASCII_PAIRS[openChar];
  }
  if (includeCJK && CJK_BRACKET_PAIRS[openChar]) {
    return CJK_BRACKET_PAIRS[openChar];
  }
  if (includeCJK && includeCurlyQuotes && CJK_CURLY_QUOTE_PAIRS[openChar]) {
    return CJK_CURLY_QUOTE_PAIRS[openChar];
  }
  return null;
}

/**
 * Check if a character is an opening bracket/quote
 */
export function isOpeningChar(char: string, config: boolean | PairConfig): boolean {
  return getClosingChar(char, config) !== null;
}

/**
 * Check if a character is a closing bracket/quote
 */
export function isClosingChar(char: string): boolean {
  return CLOSING_CHARS.has(char);
}

/**
 * Find the opening character for a closing character
 */
export function getOpeningChar(closeChar: string): string | null {
  for (const [open, close] of Object.entries(ASCII_PAIRS)) {
    if (close === closeChar) return open;
  }
  for (const [open, close] of Object.entries(CJK_PAIRS)) {
    if (close === closeChar) return open;
  }
  return null;
}
