/**
 * What counts as an HTML character reference, defined ONCE.
 *
 * Purpose: two consumers need this and they must not disagree —
 * `markdownParser.ts` protects references from every formatting rule, and
 * `integrity.ts` refuses a run that changed one. If the detector's idea of a
 * reference were narrower than the checker's, the checker would reject runs
 * the formatter never touched; if wider, corruption would slip past both.
 *
 * # Shape, not the HTML5 name table
 *
 * A named reference is only *valid* if its name is one of the ~2,200 entries in
 * the HTML5 table, and nothing in this dependency tree ships that table
 * (`character-entities`, `entities` and `parse-entities` all resolve to
 * nothing). Adding a package to spell-check entity names would be a poor trade
 * for what this is guarding, so the match is SHAPE-based.
 *
 * The consequence is deliberate and one-directional. A shape match can
 * over-protect — `&notareference;` is treated as a reference — and the cost of
 * that is one ASCII semicolon in unusual prose keeping its narrow form. It
 * cannot under-protect a real reference, and the cost of THAT is the silent
 * document corruption in issue #1382. The asymmetry decides it.
 *
 * `&` alone is not enough to trigger anything: the name form requires at least
 * two name characters, so `Q&A`, `A & B` and `a &  b;` are ordinary prose.
 *
 * @coordinates-with markdownParser.ts — the character_reference detector
 * @coordinates-with integrity.ts — referenceInventory uses the same pattern
 * @module lib/cjkFormatter/characterReferences
 */

/**
 * Decimal, hexadecimal, and named character references.
 *
 * Bounds match the HTML spec's own limits: a numeric reference is at most seven
 * decimal or six hexadecimal digits (U+10FFFF is `1114111` / `10FFFF`), and the
 * longest name in the HTML5 table is 31 characters. Bounding them is what stops
 * a stray `&` and a distant `;` from swallowing a paragraph of CJK between them
 * and disabling formatting across it.
 */
const CHARACTER_REFERENCE_SOURCE =
  "&(?:#\\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});";

/** A fresh global matcher. Never share one — `lastIndex` is per-scan state. */
export function characterReferenceMatcher(): RegExp {
  return new RegExp(CHARACTER_REFERENCE_SOURCE, "g");
}

/**
 * Every character reference in `text`, in order of appearance.
 *
 * A SEQUENCE rather than a count, matching the reasoning in `integrity.ts`: a
 * count passes when one reference is corrupted and another is introduced, which
 * is exactly the swap the width rule could produce across a paragraph.
 */
export function findCharacterReferences(text: string): string[] {
  return text.match(characterReferenceMatcher()) ?? [];
}
