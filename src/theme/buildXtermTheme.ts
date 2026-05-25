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

/**
 * Build a complete xterm.js ITheme for a specific theme ID.
 *
 * Callers read `appearance.theme` themselves and pass the ID — this
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
    selectionBackground: terminal.selectionBackground,

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

    scrollbarSliderBackground:       terminal.scrollbar.idle,
    scrollbarSliderHoverBackground:  terminal.scrollbar.hover,
    scrollbarSliderActiveBackground: terminal.scrollbar.active,
  };
}
