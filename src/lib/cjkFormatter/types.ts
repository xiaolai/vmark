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

/**
 * Per-invocation options, distinct from the user's `CJKFormattingSettings`.
 *
 * `startsAtLineStart` / `endsAtLineEnd` describe the SEGMENT the rules are
 * running on. A segment boundary is not a line boundary — a segment ends
 * wherever a protected region begins — and the two line-anchored rules
 * (`removeTrailingSpaces`, `collapseSpaces`) are wrong without that
 * distinction: they deleted the space before every inline code span, image,
 * wiki link, footnote reference, inline math span and HTML tag in the
 * document (WI-CJKF2.1). Both default to true, which is correct for a whole
 * document.
 */
export interface FormatOptions {
  /** Keep a two-or-more-space run at end of line: it is a hard BREAK, not junk. */
  preserveTwoSpaceHardBreaks?: boolean;
  /** The text's first offset is offset 0 of a line in the enclosing document. */
  startsAtLineStart?: boolean;
  /** The text's last offset is the end of a line in the enclosing document. */
  endsAtLineEnd?: boolean;
}

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

// ---------------------------------------------------------------------------
// Protected regions
// ---------------------------------------------------------------------------

/**
 * A span of the document that must be excluded from formatting.
 *
 * Here rather than in `markdownParser.ts` because the line-oriented detectors
 * live in a sibling module (`markdownParserBlocks.ts`) and append to the
 * caller's array — so both files need the type, and importing it from the
 * parser made the two modules circular.
 */
export interface ProtectedRegion {
  start: number;
  end: number;
  type:
    | "fenced_code"
    | "inline_code"
    | "indented_code"
    | "link_url"
    | "image"
    | "frontmatter"
    | "html_tag"
    | "wiki_link"
    | "footnote_ref"
    | "footnote_def"
    | "math_block"
    | "math_inline"
    | "thematic_break"
    | "reference_section";
}

export interface ProtectedRegionOptions {
  /** Skip ## References and ## Further Reading sections (off by default). */
  skipReferenceSections?: boolean;
}
