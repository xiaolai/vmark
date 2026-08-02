/**
 * Purpose: the CJK formatter's configuration contract.
 *
 * Here rather than in the settings store because it describes what the
 * FORMATTER accepts, not where the values are kept — `formatter.ts` was
 * already importing it from `@/stores`, which had the dependency backwards,
 * and it kept `toolbarActions` coupled to the store for a plain data shape
 * (ADR-015).
 *
 * @coordinates-with lib/cjkFormatter/formatter.ts — the consumer
 * @coordinates-with stores/settingsTypes/cjk.ts — re-exports this for settings
 * @module lib/cjkFormatter/types
 */

/** Target quote style: curly (""), corner (「」), or guillemets (<<>>). */
export type QuoteStyle = "curly" | "corner" | "guillemets";

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

/**
 * The formatter's defaults, shared with the settings store's `initialState`.
 *
 * One literal, not two: a plugin seam that defaults differently from the app
 * would silently format text two ways depending on whether a host was bound.
 * `src/stores/settingsStore/defaults.ts` spreads this.
 */
export const DEFAULT_CJK_FORMATTING: CJKFormattingSettings = {
  ellipsisNormalization: true,
  newlineCollapsing: false,
  fullwidthAlphanumeric: true,
  fullwidthPunctuation: true,
  fullwidthParentheses: true,
  fullwidthBrackets: false,
  cjkEnglishSpacing: true,
  cjkParenthesisSpacing: true,
  currencySpacing: true,
  slashSpacing: true,
  spaceCollapsing: true,
  dashConversion: true,
  emdashSpacing: true,
  smartQuoteConversion: true,
  quoteStyle: "curly",
  contextualQuotes: true,
  quoteSpacing: true,
  singleQuoteSpacing: true,
  cjkCornerQuotes: false,
  cjkNestedQuotes: false,
  quoteToggleMode: "simple",
  consecutivePunctuationLimit: 0,
  trailingSpaceRemoval: true,
  skipReferenceSections: false,
};
