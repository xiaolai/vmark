/**
 * CJK formatting settings types — quote styles, auto-pairing, and the
 * fine-grained CJK formatter toggles.
 *
 * Extracted from settingsTypes.ts, which remains the stable entry point.
 *
 * @module stores/settingsTypes/cjk
 */

// ---------------------------------------------------------------------------
// CJK
// ---------------------------------------------------------------------------

/** Target quote style: curly (""), corner (「」), or guillemets (<<>>). */
export type QuoteStyle = "curly" | "corner" | "guillemets";

/** CJK bracket auto-pairing style: "off" disables, "auto" enables smart pairing. */
export type AutoPairCJKStyle = "off" | "auto";

// ---------------------------------------------------------------------------
// CJK Formatting
// ---------------------------------------------------------------------------

/** Fine-grained CJK formatting toggles for spacing, normalization, dashes, and quotes. */
export interface CJKFormattingSettings {
  // Group 1: Universal
  ellipsisNormalization: boolean;
  newlineCollapsing: boolean;
  // Group 2: Fullwidth Normalization
  fullwidthAlphanumeric: boolean;
  fullwidthPunctuation: boolean;
  fullwidthParentheses: boolean;
  fullwidthBrackets: boolean;
  // Group 3: Spacing
  cjkEnglishSpacing: boolean;
  cjkParenthesisSpacing: boolean;
  currencySpacing: boolean;
  slashSpacing: boolean;
  spaceCollapsing: boolean;
  // Group 4: Dash & Quote
  dashConversion: boolean;
  emdashSpacing: boolean;
  smartQuoteConversion: boolean; // Convert straight quotes to smart quotes
  quoteStyle: QuoteStyle; // Target quote style for conversion
  contextualQuotes: boolean; // When true: curly for CJK context, straight for pure Latin
  quoteSpacing: boolean;
  singleQuoteSpacing: boolean;
  cjkCornerQuotes: boolean;
  cjkNestedQuotes: boolean;
  quoteToggleMode: "simple" | "full-cycle"; // Toggle behavior: simple (2-state) or full-cycle (4-state)
  // Group 5: Cleanup
  consecutivePunctuationLimit: number; // 0=off, 1=single, 2=double
  trailingSpaceRemoval: boolean;
  // Group 6: Section Handling
  skipReferenceSections: boolean; // Skip ## References and ## Further Reading (off by default)
}
