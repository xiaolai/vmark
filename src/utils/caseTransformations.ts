/**
 * Case Transformations
 *
 * Purpose: Pure functions for text case transformations, shared between
 * WYSIWYG (Tiptap) and Source (CodeMirror) editors. Split out of
 * textTransformations.ts to keep that file within the size gate; it
 * re-exports these, so consumers keep a single import site.
 *
 * Key decisions:
 *   - Title Case uses Unicode-aware word boundary detection
 *   - All functions are pure — no editor state dependency
 *
 * @coordinates-with utils/textTransformations.ts — re-exports this module
 * @module utils/caseTransformations
 */

/**
 * Convert text to UPPERCASE.
 */
export function toUpperCase(text: string): string {
  return text.toUpperCase();
}

/**
 * Convert text to lowercase.
 */
export function toLowerCase(text: string): string {
  return text.toLowerCase();
}

/**
 * Convert text to Title Case.
 * Capitalizes the first letter of each word. Word starts are detected
 * with Unicode-aware boundaries (`\p{L}`/`\p{N}`), so accented letters
 * capitalize correctly; apostrophes (both `'` and `’`) are treated as
 * word-internal so contractions stay intact ("don't" → "Don't", never
 * "Don'T").
 */
export function toTitleCase(text: string): string {
  return text.replace(
    /(^|[^\p{L}\p{N}'’])(\p{L})/gu,
    (_match, boundary: string, letter: string) =>
      boundary + letter.toUpperCase(),
  );
}

/**
 * Toggle case: if mostly uppercase, convert to lowercase; otherwise,
 * convert to uppercase.
 *
 * Counting is Unicode-aware: a character is cased when its upper- and
 * lowercase forms differ, and its current case is determined by comparing
 * it to those forms. Caseless characters (CJK, digits, punctuation) and
 * titlecase digraphs (e.g. ǅ — neither fully upper nor lower) are ignored.
 */
export function toggleCase(text: string): string {
  let upperCount = 0;
  let lowerCount = 0;

  for (const char of text) {
    const upper = char.toUpperCase();
    const lower = char.toLowerCase();
    if (upper === lower) continue; // caseless
    if (char === upper) upperCount += 1;
    else if (char === lower) lowerCount += 1;
  }

  // If more than half are uppercase (or equal), convert to lowercase
  if (upperCount >= lowerCount) {
    return text.toLowerCase();
  }
  return text.toUpperCase();
}
