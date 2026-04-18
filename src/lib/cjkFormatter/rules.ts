/**
 * CJK Text Formatting Rules — barrel.
 *
 * Purpose: Individual formatting rules for CJK typography, grouped into
 * sibling files under `rules/`:
 *   1. Universal (ellipsis, newlines) — apply to all text
 *   2. Fullwidth normalization (alphanumeric, punctuation, brackets)
 *   3. Spacing (CJK-Latin gaps, parentheses, currency/units, slashes)
 *   4. Dash & quote conversion (em-dashes, smart quotes, corner brackets)
 *   5. Cleanup (consecutive punctuation limits, trailing spaces)
 *
 * Key decisions (applied by `applyRules`):
 *   - Rule ordering is deliberate: normalization before spacing,
 *     dashes/quotes before spacing rules, cleanup last.
 *   - containsCJK() gates most rules — pure Latin text skips CJK-specific transforms.
 *   - Punctuation conversion uses neighbor context: a comma becomes fullwidth only
 *     when adjacent to a CJK character, not in pure Latin sentences.
 *   - Ordered list marker periods ("1.", "10.") are protected from fullwidth
 *     conversion via isOrderedListMarker() inside fullwidth.ts.
 *   - Technical subspans (URLs, versions, times) are protected from punctuation
 *     conversion via the Latin span scanner.
 *   - Surrogate pair handling in getLeftNeighbor/getRightNeighbor for Extension B-G Han.
 *   - Final trimEnd() is NOT done here — it happens in formatMarkdown() after
 *     segment reconstruction to avoid breaking segment boundaries.
 *
 * Ported from Python cjk-text-formatter project.
 *
 * @coordinates-with formatter.ts — applyRules is the main entry point called per segment
 * @coordinates-with latinSpanScanner.ts — technical subspan protection for punctuation
 * @coordinates-with quotePairing.ts — stack-based quote conversion for curly/corner styles
 * @coordinates-with settingsStore.ts — CJKFormattingSettings controls which rules are active
 * @module lib/cjkFormatter/rules
 */

export { containsCJK } from "./rules/shared";
export { normalizeEllipsis, collapseNewlines } from "./rules/universal";
export {
  normalizeFullwidthAlphanumeric,
  normalizeFullwidthPunctuation,
  normalizeFullwidthParentheses,
  normalizeFullwidthBrackets,
} from "./rules/fullwidth";
export {
  addCJKEnglishSpacing,
  addCJKParenthesisSpacing,
  fixCurrencySpacing,
  fixSlashSpacing,
  collapseSpaces,
} from "./rules/spacing";
export {
  convertDashes,
  fixEmdashSpacing,
  fixDoubleQuoteSpacing,
  fixSingleQuoteSpacing,
  fixCornerQuoteSpacing,
  fixDoubleCornerQuoteSpacing,
  convertStraightToSmartQuotes,
  convertToCJKCornerQuotes,
  convertNestedCornerQuotes,
} from "./rules/dashesQuotes";
export {
  limitConsecutivePunctuation,
  removeTrailingSpaces,
} from "./rules/cleanup";
export { applyRules } from "./rules/applyRules";
