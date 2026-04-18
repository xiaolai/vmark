/**
 * CJK rule internals — character ranges, punctuation maps, and neighbor helpers.
 *
 * Private plumbing shared across the individual rule groups in
 * `src/lib/cjkFormatter/rules/`. Consumers should import from
 * `@/lib/cjkFormatter/rules` (the barrel), not from this file directly.
 *
 * @module lib/cjkFormatter/rules/shared
 */

// Character ranges - Extended CJK coverage
const HAN_BASIC = "\u4e00-\u9fff"; // CJK Unified Ideographs (basic block)
const HAN_EXT_A = "\u3400-\u4dbf"; // CJK Extension A (rare characters)
// Note: Extensions B-G (U+20000-U+2CEAF) are beyond BMP, require surrogate pairs
const BOPOMOFO = "\u3100-\u312f"; // Bopomofo (Zhuyin)
const BOPOMOFO_EXT = "\u31a0-\u31bf"; // Bopomofo Extended
const HIRAGANA = "\u3040-\u309f";
const KATAKANA = "\u30a0-\u30ff";
const KATAKANA_EXT = "\u31f0-\u31ff"; // Katakana Phonetic Extensions
// Combined ranges
const HAN = `${HAN_BASIC}${HAN_EXT_A}`;
// Korean excluded from spacing rules: Korean uses native word spacing and
// particles attach directly to preceding words (e.g., "VMark에는").
export const CJK_NO_KOREAN = `${HAN}${BOPOMOFO}${BOPOMOFO_EXT}${HIRAGANA}${KATAKANA}${KATAKANA_EXT}`;

// CJK punctuation
export const CJK_TERMINAL_PUNCTUATION = "，。！？；：、";
export const CJK_CLOSING_BRACKETS = "》」』】）〉";
export const CJK_OPENING_BRACKETS = "《「『【（〈";

// Character class patterns
export const CJK_CHARS_PATTERN = `[${HAN}${HIRAGANA}${KATAKANA}《》「」『』【】（）〈〉，。！？；：、]`;

// Punctuation conversion map (half-width → full-width)
export const PUNCTUATION_MAP: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ";": "；",
  ":": "：",
};

/** Nearest non-space character to the left of `pos` (handles surrogate pairs). */
export function getLeftNeighbor(text: string, pos: number): string {
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] !== " " && text[i] !== "\t") {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      // Combine surrogate pair if we landed on a low surrogate.
      if (code >= 0xdc00 && code <= 0xdfff && i - 1 >= 0) {
        const prev = text[i - 1];
        const prevCode = prev.charCodeAt(0);
        /* v8 ignore next -- @preserve Defensive guard: stranded low surrogate without a preceding high surrogate is malformed UTF-16 that cannot occur in well-formed JS strings */
        if (prevCode >= 0xd800 && prevCode <= 0xdbff) {
          return prev + ch;
        }
      }
      return ch;
    }
  }
  return "";
}

/** Nearest non-space character to the right of `pos` (handles surrogate pairs). */
export function getRightNeighbor(text: string, pos: number): string {
  for (let i = pos + 1; i < text.length; i++) {
    if (text[i] !== " " && text[i] !== "\t") {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      // Combine surrogate pair if we landed on a high surrogate.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const next = text[i + 1];
        const nextCode = next.charCodeAt(0);
        /* v8 ignore next -- @preserve Defensive guard: stranded high surrogate without a following low surrogate is malformed UTF-16 that cannot occur in well-formed JS strings */
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
 * Check if text contains CJK characters (Han, Kana, or Hangul).
 * Uses Unicode script property escapes for full coverage including supplementary planes.
 */
export function containsCJK(text: string): boolean {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Bopomofo}/u.test(
    text
  );
}
