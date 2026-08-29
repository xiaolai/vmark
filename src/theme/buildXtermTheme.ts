/**
 * buildXtermTheme — compose an xterm.js `ITheme` from the active typed
 * `ThemeTokens`. The single source of truth for terminal colors.
 *
 * Before theme-unification-2026-05, terminal colors lived in a hand-
 * tuned `ansiPalettes` table inside `src/components/Terminal/
 * terminalTheme.ts`. That table is now `ThemeTokens.terminal` per
 * theme, and this function is the one place that knows how to map it
 * to xterm's `ITheme` shape.
 *
 * @coordinates-with theme/themes/* — provides the terminal block
 * @coordinates-with components/Terminal/createTerminalInstance.ts — consumer
 * @coordinates-with components/Terminal/terminalSessionStoreSync.ts — consumer
 * @module theme/buildXtermTheme
 */

import type { ITheme } from "@xterm/xterm";
import { themes, type ThemeId } from "./themes";

/** `rgba(r, g, b, a)` / `#rrggbb` → the same colour at a new alpha. */
export function withAlpha(color: string, alpha: number): string {
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(color.trim());
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

/**
 * Build a complete xterm.js ITheme for a specific theme ID.
 *
 * Callers resolve the effective theme id themselves (via
 * `getEffectiveThemeId`) and pass it in — this
 * function deliberately does not import the settings store, to keep
 * @/theme free of a back-edge into stores (avoids a dep-cruiser cycle:
 * settingsStore → @/theme → buildXtermTheme → settingsStore).
 *
 * Guards against corrupted persisted themeId via `hasOwnProperty` — a
 * raw `themes[id] ?? themes.paper` would let `id = "__proto__"` reach
 * `Object.prototype` and skip the fallback (low impact but real).
 */
export function buildXtermThemeForId(themeId: ThemeId): ITheme {
  const hasTheme = Object.prototype.hasOwnProperty.call(themes, themeId);
  const theme = hasTheme ? themes[themeId] : themes.paper;
  const { terminal, color } = theme;
  const { ansi } = terminal;

  return {
    background:          color.bg.primary,
    foreground:          color.text.primary,
    cursor:              terminal.cursor,
    cursorAccent:        terminal.cursorAccent,
    // DERIVED (WI-UI1.4): the terminal selection IS the app selection, at a
    // slightly higher alpha because xterm composites on a canvas with no
    // ::selection ink adjustment. A separate catalog field had already
    // drifted (sepia/mint carried a dead blue).
    selectionBackground: withAlpha(color.selection, 0.25),

    // ANSI standard (0–7)
    black:   ansi.black,
    red:     ansi.red,
    green:   ansi.green,
    yellow:  ansi.yellow,
    blue:    ansi.blue,
    magenta: ansi.magenta,
    cyan:    ansi.cyan,
    white:   ansi.white,

    // ANSI bright (8–15)
    brightBlack:   ansi.brightBlack,
    brightRed:     ansi.brightRed,
    brightGreen:   ansi.brightGreen,
    brightYellow:  ansi.brightYellow,
    brightBlue:    ansi.brightBlue,
    brightMagenta: ansi.brightMagenta,
    brightCyan:    ansi.brightCyan,
    brightWhite:   ansi.brightWhite,

    // DERIVED (WI-UI1.4): thumb = text ink at xterm's own .2/.4/.5 alphas, so
    // the terminal thumb and the app thumb share one source (the app thumb is
    // color-mix on --text-secondary — same family, same ink).
    scrollbarSliderBackground:       withAlpha(color.text.primary, 0.2),
    scrollbarSliderHoverBackground:  withAlpha(color.text.primary, 0.4),
    scrollbarSliderActiveBackground: withAlpha(color.text.primary, 0.5),
  };
}

/**
 * xterm's `drawBoldTextInBrightColors` for a theme (default true). False when
 * a bright slot doubles as a text tier — see `ThemeTokens.terminal`.
 */
export function drawBoldTextInBrightColorsForId(themeId: ThemeId): boolean {
  const hasTheme = Object.prototype.hasOwnProperty.call(themes, themeId);
  const theme = hasTheme ? themes[themeId] : themes.paper;
  return theme.terminal.boldTextInBrightColors ?? true;
}
