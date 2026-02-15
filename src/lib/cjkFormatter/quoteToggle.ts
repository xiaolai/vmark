/**
 * Quote Style Toggle
 *
 * Purpose: Toggle the style of the quote pair enclosing the cursor between
 * straight, curly, corner bracket, and guillemet forms. Pure logic module
 * with no editor dependency — returns replacement descriptors.
 *
 * Key decisions:
 *   - Uses analyzeQuotes() from quotePairing.ts for straight/curly pair detection
 *     (inherits apostrophe, prime, and decade abbreviation filtering)
 *   - Separate bracket-matching pass for corner brackets and guillemets
 *     (analyzeQuotes only recognizes straight/curly characters)
 *   - All non-ASCII quote characters use Unicode escape sequences to prevent
 *     LLM character substitution in generated code
 *   - "simple" mode: straight <-> preferred style (two-state toggle)
 *   - "full-cycle" mode: straight -> curly -> corner -> guillemets -> straight
 *
 * @coordinates-with quotePairing.ts — analyzeQuotes for straight/curly pair detection
 * @coordinates-with settingsStore.ts — QuoteStyle type, quoteToggleMode setting
 * @module lib/cjkFormatter/quoteToggle
 */

import type { QuoteStyle } from "@/stores/settingsStore";
import { analyzeQuotes } from "./quotePairing";

// ============================================================================
// Types
// ============================================================================

export type QuoteStyleId = "straight" | QuoteStyle;

export interface QuoteToggleResult {
  /** Document-relative positions and replacement characters */
  replacements: Array<{ offset: number; oldChar: string; newChar: string }>;
}

// ============================================================================
// Character lookup — all Unicode escapes, no literal curly quotes
// ============================================================================

interface QuoteChars {
  doubleOpen: string;
  doubleClose: string;
  singleOpen: string;
  singleClose: string;
}

const STYLE_CHARS: Record<QuoteStyleId, QuoteChars> = {
  straight: { doubleOpen: '"', doubleClose: '"', singleOpen: "'", singleClose: "'" },
  curly: { doubleOpen: "\u201c", doubleClose: "\u201d", singleOpen: "\u2018", singleClose: "\u2019" },
  corner: { doubleOpen: "\u300c", doubleClose: "\u300d", singleOpen: "\u300e", singleClose: "\u300f" },
  guillemets: { doubleOpen: "\u00ab", doubleClose: "\u00bb", singleOpen: "\u2039", singleClose: "\u203a" },
};

/** All characters that can be a quote open/close, mapped to their style */
const CHAR_TO_STYLE: Map<string, QuoteStyleId> = new Map();
for (const [style, chars] of Object.entries(STYLE_CHARS)) {
  for (const ch of Object.values(chars)) {
    CHAR_TO_STYLE.set(ch, style as QuoteStyleId);
  }
}

/** Full-cycle order */
const CYCLE_ORDER: QuoteStyleId[] = ["straight", "curly", "corner", "guillemets"];

// ============================================================================
// Internal pair representation
// ============================================================================

interface FoundPair {
  openIndex: number;
  closeIndex: number;
  openChar: string;
  closeChar: string;
  type: "double" | "single";
  style: QuoteStyleId;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Detect the style of a quote character (open or close).
 */
export function detectQuoteStyle(char: string): QuoteStyleId {
  return CHAR_TO_STYLE.get(char) ?? "straight";
}

/**
 * Get the next style in the toggle/cycle sequence.
 *
 * - simple mode: straight -> preferredStyle, anything else -> straight
 * - full-cycle mode: straight -> curly -> corner -> guillemets -> straight
 */
export function getNextQuoteStyle(
  current: QuoteStyleId,
  mode: "simple" | "full-cycle",
  preferredStyle: QuoteStyle,
): QuoteStyleId {
  if (mode === "simple") {
    return current === "straight" ? preferredStyle : "straight";
  }
  // full-cycle
  const idx = CYCLE_ORDER.indexOf(current);
  return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
}

/**
 * Find the innermost quote pair enclosing cursorOffset and compute replacements
 * to toggle it to the next style.
 *
 * Returns null if cursor is not inside any quote pair.
 */
export function computeQuoteToggle(
  text: string,
  cursorOffset: number,
  mode: "simple" | "full-cycle",
  preferredStyle: QuoteStyle,
): QuoteToggleResult | null {
  const allPairs = findAllQuotePairs(text);

  // Filter to pairs enclosing the cursor (inclusive of open/close positions)
  const enclosing = allPairs.filter(
    (p) => p.openIndex <= cursorOffset && cursorOffset <= p.closeIndex
  );

  if (enclosing.length === 0) return null;

  // Pick innermost (smallest span)
  enclosing.sort((a, b) => (a.closeIndex - a.openIndex) - (b.closeIndex - b.openIndex));
  const target = enclosing[0];

  // Determine next style
  const nextStyleId = getNextQuoteStyle(target.style, mode, preferredStyle);
  const nextChars = STYLE_CHARS[nextStyleId];

  // Get the appropriate open/close characters for the quote type
  const newOpen = target.type === "double" ? nextChars.doubleOpen : nextChars.singleOpen;
  const newClose = target.type === "double" ? nextChars.doubleClose : nextChars.singleClose;

  return {
    replacements: [
      { offset: target.openIndex, oldChar: target.openChar, newChar: newOpen },
      { offset: target.closeIndex, oldChar: target.closeChar, newChar: newClose },
    ],
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Find all quote pairs in text:
 * 1. analyzeQuotes() handles straight and curly (with apostrophe/prime filtering)
 * 2. Simple bracket matching handles corner brackets and guillemets
 */
function findAllQuotePairs(text: string): FoundPair[] {
  const pairs: FoundPair[] = [];

  // --- Straight / curly via analyzeQuotes ---
  const { pairs: analyzedPairs } = analyzeQuotes(text);
  for (const p of analyzedPairs) {
    const openChar = text[p.openIndex];
    const closeChar = text[p.closeIndex];
    pairs.push({
      openIndex: p.openIndex,
      closeIndex: p.closeIndex,
      openChar,
      closeChar,
      type: p.type,
      style: detectQuoteStyle(openChar),
    });
  }

  // --- Corner brackets and guillemets via simple stack matching ---
  // Derived from STYLE_CHARS to avoid duplicating character literals
  const bracketStyles = ["corner", "guillemets"] as const;
  const bracketSets: [string, string, "double" | "single", QuoteStyleId][] =
    bracketStyles.flatMap((style) => {
      const chars = STYLE_CHARS[style];
      return [
        [chars.doubleOpen, chars.doubleClose, "double" as const, style],
        [chars.singleOpen, chars.singleClose, "single" as const, style],
      ];
    });

  for (const [open, close, type, style] of bracketSets) {
    const stack: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === open) {
        stack.push(i);
      } else if (text[i] === close && stack.length > 0) {
        const openIdx = stack.pop()!;
        pairs.push({
          openIndex: openIdx,
          closeIndex: i,
          openChar: open,
          closeChar: close,
          type,
          style,
        });
      }
    }
  }

  return pairs;
}
