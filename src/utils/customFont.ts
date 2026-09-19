/**
 * Custom font families — the encoding, and the one validator (#1429).
 *
 * Purpose: VMark's font settings were a CLOSED list of curated keys, so a font
 * the user installed but VMark did not name (LXGW WenKai / 霞鹜文楷 in the
 * report) was unreachable. A font setting now also accepts `custom:<family>`.
 *
 * Its own module, not part of `fontStacks`, because it is the SECURITY half of
 * the feature: everything that turns untrusted text into a CSS family
 * reference is here, in one place small enough to read in full.
 *
 * @coordinates-with utils/fontStacks.ts — resolves a parsed family into a stack
 * @coordinates-with services/fonts/systemFonts.ts — re-validates enumerated names
 * @coordinates-with pages/settings/FontSettingRow.tsx — the picker
 * @module utils/customFont
 */

/**
 * Marks a font setting as a USER-SUPPLIED family name rather than one of the
 * curated keys in `utils/fontOptions`.
 *
 * The prefix, rather than a second settings field per role, is what lets every
 * existing consumer keep working unchanged: `useTheme`, the PDF export's
 * typography CSS and the terminal's live mono sync all resolve the one string
 * they already read, so a custom family reaches all three at once and no
 * persisted value has to be migrated. `:` cannot occur in a curated key, so
 * the two namespaces cannot collide.
 */
const CUSTOM_FONT_PREFIX = "custom:";

/** Longest family name accepted. Real ones are far shorter; the cap exists so
 *  a pasted blob cannot become a stylesheet. */
const CUSTOM_FONT_MAX_LENGTH = 64;

/**
 * Everything a family name may not contain.
 *
 * This value is written VERBATIM into a CSS declaration this app emits
 * (`--font-sans: …`), and it arrives from persisted settings — localStorage,
 * editable by hand and by anything that ever runs in the webview — and from
 * the backend's font enumeration.
 *
 * Quotes and backslashes escape the quoted family; `;` `{` `}` end the
 * declaration or the rule; `(` `)` reach `url()` and the legacy
 * `expression()`; `/` `*` open a comment; `,` would silently turn one family
 * into a stack the UI never showed. Control characters are excluded because a
 * newline ends a declaration just as well as a semicolon does.
 *
 * Deliberately a DENY list over an allow list: family names are drawn from the
 * whole of Unicode — 霞鹜文楷, Тахома, ＭＳ 明朝 — and an allow list narrow
 * enough to be safe would refuse most of the world's fonts. The dangerous set
 * is small, closed and ASCII.
 *
 * The control range is spelled as the Unicode categories rather than as a
 * literal `\u0000-\u001f`: it says what it means, and it also catches the
 * invisible FORMAT characters a pasted name can carry (zero-width space, the
 * bidi marks) — a name whose end nobody can see is not a name worth taking.
 */
const CUSTOM_FONT_DISALLOWED = /[\p{Cc}\p{Cf}"'`\\;{}()<>,:*/@[\]$&%!?=|^~#]/u;

/** The setting value that selects `family` as a custom font. */
export function customFontValue(family: string): string {
  return `${CUSTOM_FONT_PREFIX}${family}`;
}

/**
 * `raw` reduced to a family name safe to emit inside a quoted CSS value, or
 * null when it is empty, too long, or contains anything from the set above.
 *
 * Null is the FAIL-SAFE, not an error path: an unusable value resolves to the
 * curated system stack, so the worst outcome of a bad setting is the default
 * font — never a broken stylesheet and never an injected declaration.
 */
export function sanitizeCustomFontFamily(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed || collapsed.length > CUSTOM_FONT_MAX_LENGTH) return null;
  if (CUSTOM_FONT_DISALLOWED.test(collapsed)) return null;
  return collapsed;
}

/** The sanitized family a custom font setting names, or null for a curated key. */
export function parseCustomFont(value: string): string | null {
  if (!value.startsWith(CUSTOM_FONT_PREFIX)) return null;
  return sanitizeCustomFontFamily(value.slice(CUSTOM_FONT_PREFIX.length));
}

/** A sanitized family as a CSS family reference. Safe to quote because
 *  `sanitizeCustomFontFamily` has already refused every quote character. */
export function quoteFamily(family: string): string {
  return `"${family}"`;
}
