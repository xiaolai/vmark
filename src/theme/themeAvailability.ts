/**
 * Which themes a platform can actually offer.
 *
 * Purpose: Windows and Linux draw the title bar (and, on Windows, the menu
 * bar) themselves, and the only choice the OS accepts is light or dark. A
 * sepia or mint theme therefore has no matching chrome available at any
 * price — the window would always be half-themed. Those platforms are limited
 * to one light theme and one dark theme, each of which maps exactly onto what
 * the OS can render.
 *
 * macOS is unaffected: its Settings window uses an overlay title bar and its
 * menus live in the system bar, so the full catalog stays available.
 *
 * Key decisions:
 *   - Coercion preserves *polarity*. Someone who chose sepia (light) and moves
 *     to Windows gets white, not night — settings sync between machines must
 *     not flip a user from light to dark.
 *   - Pure and platform-agnostic: callers pass `isMac`, so this stays testable
 *     without stubbing `navigator`.
 *
 * @coordinates-with hooks/useEffectiveTheme.ts — coerces the resolved theme
 * @coordinates-with pages/settings/AppearanceSettings.tsx — filters the swatches
 * @module theme/themeAvailability
 */

import { themes } from "./themes";
import type { ThemeId } from "./themes";

/** The light/dark pair offered on Windows and Linux. */
export const NON_MAC_THEME_IDS: readonly ThemeId[] = Object.freeze([
  "white",
  "night",
] as ThemeId[]);

/** Themes the theme picker should offer on this platform. */
export function selectableThemeIds(isMac: boolean): ThemeId[] {
  // Copies both branches so a caller mutating the result cannot corrupt the
  // frozen constant or the catalog's key order.
  return isMac ? (Object.keys(themes) as ThemeId[]) : [...NON_MAC_THEME_IDS];
}

/**
 * Map a stored theme onto one this platform can render.
 *
 * Unknown ids fall back to white rather than throwing: corrupted persisted
 * settings are a real case, and the theme layer already treats them as
 * recoverable.
 */
export function coerceThemeId(id: ThemeId, isMac: boolean): ThemeId {
  if (isMac) return id;
  if (NON_MAC_THEME_IDS.includes(id)) return id;
  return neutralThemeId(id);
}

/**
 * The neutral counterpart of a theme, by polarity: `white` for a light theme,
 * `night` for a dark one.
 *
 * Two callers want this for different reasons — platform coercion above, and the
 * browser-chrome neutral in `terminalThemeForBrowser.ts` — and they had it
 * written out twice. The mapping and the pair are the same fact either way, so
 * it lives here once, beside `NON_MAC_THEME_IDS` which is that same pair.
 *
 * An unknown id resolves to the light neutral rather than throwing: corrupted
 * persisted settings are a real case, and `themes[id]?.isDark` is also what makes
 * `"__proto__"` land on the fallback instead of reaching `Object.prototype`.
 */
export function neutralThemeId(id: ThemeId): ThemeId {
  return themes[id]?.isDark ? "night" : "white";
}
