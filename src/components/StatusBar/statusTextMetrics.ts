// audit-fix — strip punctuation before alfaaz; code-point-correct char count
import { countWords as alfaazCount } from "alfaaz";

/** Strip markdown formatting to get plain text for word counting. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// CJK scripts that count toward 字数: Han ideographs + Japanese kana.
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
// Unicode punctuation and symbols (covers ASCII + fullwidth CJK marks + emoji).
const PUNCT_OR_SYMBOL_RE = /[\p{P}\p{S}]/gu;

/**
 * Count words using alfaaz (handles CJK and other languages).
 *
 * Punctuation and symbols are stripped first: alfaaz tokenizes each glyph it
 * sees as a word, so fullwidth CJK marks (`，` `！`) and ASCII punctuation would
 * otherwise inflate the count. Stripping them matches the writer's intent — a
 * word count without punctuation.
 */
export function countWordsFromPlain(plainText: string): number {
  return alfaazCount(plainText.replace(PUNCT_OR_SYMBOL_RE, ""));
}

/**
 * Count non-whitespace characters, code-point correct.
 *
 * Uses `Array.from` so astral characters and emoji count as one each, matching
 * {@link computeTextMetrics}; `String.prototype.length` over-counts them by
 * their UTF-16 surrogate-pair length.
 */
export function countCharsFromPlain(plainText: string): number {
  return Array.from(plainText.replace(/\s/g, "")).length;
}

/**
 * Full word/character breakdown for a piece of plain text. Callers pass
 * already-`stripMarkdown`'d text so the numbers match what the reader sees,
 * not the raw markdown source.
 *
 * All character counts are code-point correct (`Array.from` / spread), so
 * astral characters and emoji count as one each — `String.prototype.length`
 * would over-count them by their UTF-16 surrogate-pair length.
 */
export interface TextMetrics {
  /**
   * Word count via alfaaz, with punctuation/symbols stripped first. Each CJK
   * character counts as one word; punctuation marks are not counted.
   */
  words: number;
  /** Every character, whitespace included (code-point count). */
  charsWithSpaces: number;
  /** Characters with all whitespace (`\s`) removed. */
  charsNoSpaces: number;
  /**
   * CJK character count — the meaningful 字数 for Chinese/Japanese writers.
   * Matches Han ideographs plus Hiragana and Katakana.
   */
  cjkChars: number;
  /**
   * Characters excluding whitespace AND punctuation/symbols. Both Unicode
   * punctuation (`\p{P}`, e.g. `,` `。` `，` `！`) and symbols (`\p{S}`, e.g.
   * `$` `+` `%` and emoji) are removed, so this is a "letters & digits only"
   * count — the closest match to a writer's intuitive "real characters".
   */
  charsNoPunctuation: number;
}

/** Compute the full {@link TextMetrics} breakdown for stripped plain text. */
export function computeTextMetrics(plainText: string): TextMetrics {
  const codePoints = Array.from(plainText);
  const charsWithSpaces = codePoints.length;
  const noSpaces = plainText.replace(/\s/g, "");
  const charsNoSpaces = Array.from(noSpaces).length;
  const cjkChars = (plainText.match(CJK_RE) ?? []).length;
  const charsNoPunctuation = Array.from(
    noSpaces.replace(PUNCT_OR_SYMBOL_RE, "")
  ).length;

  return {
    // countWordsFromPlain strips punctuation/symbols itself, so fullwidth CJK
    // marks and ASCII punctuation aren't counted as words.
    words: countWordsFromPlain(plainText),
    charsWithSpaces,
    charsNoSpaces,
    cjkChars,
    charsNoPunctuation,
  };
}
