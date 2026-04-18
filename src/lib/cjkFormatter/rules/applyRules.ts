/**
 * applyRules — dispatcher that runs enabled CJK rules in the correct order.
 *
 * Rule ordering is deliberate: normalization before spacing, dashes/quotes
 * before spacing, cleanup last. See header of rules/shared.ts for full rationale.
 *
 * @coordinates-with formatter.ts — per-segment entry point
 * @coordinates-with settingsStore — CJKFormattingSettings controls which rules run
 * @module lib/cjkFormatter/rules/applyRules
 */

import type { CJKFormattingSettings } from "@/stores/settingsStore";
import { applyContextualQuotes } from "../quotePairing";
import { containsCJK } from "./shared";
import { normalizeEllipsis, collapseNewlines } from "./universal";
import {
  normalizeFullwidthAlphanumeric,
  normalizeFullwidthPunctuation,
  normalizeFullwidthParentheses,
  normalizeFullwidthBrackets,
} from "./fullwidth";
import {
  addCJKEnglishSpacing,
  addCJKParenthesisSpacing,
  fixCurrencySpacing,
  fixSlashSpacing,
  collapseSpaces,
} from "./spacing";
import {
  convertDashes,
  fixEmdashSpacing,
  fixDoubleQuoteSpacing,
  fixSingleQuoteSpacing,
  convertStraightToSmartQuotes,
  convertNestedCornerQuotes,
} from "./dashesQuotes";
import {
  limitConsecutivePunctuation,
  removeTrailingSpaces,
} from "./cleanup";

/** Apply all enabled CJK formatting rules to text. */
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

  // Note: Do NOT trimEnd() here - it breaks segment boundaries when protected
  // regions (like thematic breaks) split the document. Final cleanup happens
  // in formatMarkdown() after all segments are reconstructed.
  return text;
}
