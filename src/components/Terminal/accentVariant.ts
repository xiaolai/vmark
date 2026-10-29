/**
 * accentVariant — decides whether a character is one of the accented forms the
 * macOS press-and-hold picker offers for a letter (`u` → `ü`, `a` → `æ`).
 *
 * The terminal IME gate uses it to recognise a press-and-hold pick that must
 * replace the letter xterm already wrote to the PTY (#1608).
 *
 * Key decisions:
 *   - Most variants decompose (NFD) to the base letter plus combining marks;
 *     the few that do not (æ, ø, œ, ß, ł) are listed explicitly.
 *   - Case must match: the picker keeps the case of the held key.
 *
 * @module components/Terminal/accentVariant
 */

/** Picker variants with no canonical decomposition onto their base letter. */
const LIGATURE_VARIANTS: Readonly<Record<string, string>> = {
  a: "æ",
  o: "øœ",
  s: "ß",
  l: "ł",
  A: "Æ",
  O: "ØŒ",
  L: "Ł",
};

const COMBINING_MARKS_RE = /^\p{M}+$/u;

/** True for exactly one character (code point). */
function isSingleCodePoint(text: string): boolean {
  return text.length > 0 && [...text].length === 1;
}

/** True when `text` is an accented form of the single letter `base`. */
export function isAccentVariantOf(base: string, text: string): boolean {
  if (!isSingleCodePoint(base) || !isSingleCodePoint(text) || base === text) return false;
  if (LIGATURE_VARIANTS[base]?.includes(text)) return true;
  const decomposed = text.normalize("NFD");
  return decomposed.startsWith(base) && COMBINING_MARKS_RE.test(decomposed.slice(base.length));
}
