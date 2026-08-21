/**
 * WI-CJKF5.1 — which script a construct sits in, decided from its ADJACENT
 * characters.
 *
 * Purpose: a few rules have no single correct output across CJK. The ellipsis
 * is `……` in Chinese (GB/T 15834) and Japanese (JIS X 4051) but `…` in Korean
 * and `...` in Latin text, and only the Latin form takes a following space.
 *
 * Key decision — adjacency, not a document-level guess. `containsCJK` is
 * evaluated per SEGMENT, and a segment spans everything between two protected
 * regions, so "the document's script" is in practice the whole file's. A
 * document-level detector would rewrite the `...` inside an English quotation
 * in a Chinese file. Reading the immediate neighbours is local, needs no
 * detection pass, and is the same principle `normalizeFullwidthPunctuation`
 * uses to decide punctuation width (WI-CJKF3.1).
 *
 * @coordinates-with universal.ts — normalizeEllipsis, the only consumer today
 * @module lib/cjkFormatter/rules/script
 */

/**
 * The script family a rule should format for.
 *
 * Han, Kana and Bopomofo collapse into one bucket on purpose: every rule that
 * consults this treats Chinese and Japanese identically, and the two cannot be
 * told apart from a single Han character anyway.
 */
export type AdjacentScript = "han" | "hangul" | "none";

const HAN_LIKE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u;
const HANGUL = /\p{Script=Hangul}/u;

/**
 * Classify the character immediately before `start` or immediately after
 * `end`, whichever is CJK.
 *
 * Whitespace and line breaks are NOT skipped: a construct separated from a CJK
 * character by a space is not attached to it, the same rule the punctuation
 * width test applies.
 */
export function adjacentScript(text: string, start: number, end: number): AdjacentScript {
  // `codePointAt`/`codePointBefore` semantics via slicing, so a supplementary
  // -plane Han character is read as one character rather than a lone surrogate.
  const before = start > 0 ? String.fromCodePoint(codePointBefore(text, start)) : "";
  const after = end < text.length ? String.fromCodePoint(text.codePointAt(end) ?? 0) : "";

  for (const ch of [before, after]) {
    if (ch === "") continue;
    if (HAN_LIKE.test(ch)) return "han";
    if (HANGUL.test(ch)) return "hangul";
  }
  return "none";
}

/** The code point ending at `index` (handles a surrogate pair). */
function codePointBefore(text: string, index: number): number {
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index - 2 >= 0) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) {
      return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
    }
  }
  return low;
}
