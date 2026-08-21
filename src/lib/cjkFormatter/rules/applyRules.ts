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

import type { CJKFormattingSettings, FormatOptions } from "../types";
import { cjkFmtWarn } from "@/utils/debug";
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

/**
 * Safety cap for the fixed-point iteration in applyRules. Normal text
 * converges in 1–2 passes; hitting the cap means a rule cycle (a genuine
 * bug the idempotence property suite exists to catch), or an input deeper
 * than the cap — not normal operation.
 */
export const MAX_RULE_PASSES = 8;

/**
 * Apply all enabled CJK formatting rules to text.
 *
 * Iterates the rule chain to its FIXED POINT. The chain has producer→consumer
 * dependencies that no single ordering can satisfy: quote conversion creates
 * corner brackets (「」) that are fullwidth-punctuation and dash context, but
 * quote classification must run before the spacing rules; fullwidth
 * parentheses run after parenthesis spacing yet produce （） that earlier
 * rules key on; nested `(中(文))` needs one paren pass per nesting level.
 * A single pass therefore stops one step short on such inputs, and every
 * REPEATED format invocation used to edit the document again (中,,--“中” kept
 * growing). Each rule only moves text toward its normal form (conversions are
 * one-way), so iterating converges — `format(format(x)) === format(x)` is
 * pinned by the idempotence property suite.
 */
export function applyRules(
  text: string,
  config: CJKFormattingSettings,
  options: FormatOptions = {}
): string {
  let prev = text;
  for (let pass = 0; pass < MAX_RULE_PASSES; pass++) {
    const next = applyRulesOnce(prev, config, options);
    if (next === prev) {
      return next;
    }
    prev = next;
  }
  // Audit 20260804-F7: the cap used to be a SILENT truncation — a document
  // that needed a ninth pass came back not-quite-normalized and the next
  // "Format CJK File" edited it again, which is precisely the non-idempotence
  // the fixed-point loop exists to prevent. The result is still returned (it
  // is strictly more normalized than the input, and refusing to format would
  // be worse than formatting incompletely), but the condition is now visible.
  //
  // Only the length is logged: this runs over the user's document, and their
  // log file is something they attach to bug reports.
  cjkFmtWarn(
    `rule chain did not converge within ${MAX_RULE_PASSES} passes — returning the last pass. ` +
      "Expect the next format run to change the text again; this is a rule cycle or a " +
      "nesting depth beyond the cap.",
    { inputLength: text.length, passes: MAX_RULE_PASSES },
  );
  return prev;
}

/** One pass of the enabled rules, in their deliberate order. */
function applyRulesOnce(
  text: string,
  config: CJKFormattingSettings,
  options: FormatOptions = {}
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
    text = collapseSpaces(text, options);
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
