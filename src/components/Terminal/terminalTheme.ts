/**
 * Terminal ANSI color palettes per app theme.
 *
 * Purpose: Provides a complete xterm.js ITheme for each VMark theme,
 * including the 16 ANSI colors tuned to harmonize with the theme's
 * background/foreground while preserving semantic meaning
 * (red=error, green=success, yellow=warning, blue=info).
 *
 * @coordinates-with createTerminalInstance.ts — uses buildXtermTheme at creation
 * @coordinates-with useTerminalSessions.ts — uses buildXtermTheme for live sync
 * @coordinates-with settingsStore.ts — reads theme ID and base colors
 * @module components/Terminal/terminalTheme
 */

import type { ITheme } from "@xterm/xterm";
import { useSettingsStore, themes } from "@/stores/settingsStore";
import type { ThemeId } from "@/stores/settingsStore";

/**
 * ANSI color palette — 16 standard colors.
 *
 * Design principles:
 * - Contrast: every color readable against its theme background (WCAG AA)
 * - Semantics: red=error, green=success, yellow=warning, blue=info
 * - Bright variants: higher saturation/lightness for emphasis
 * - Black/white: track the theme's secondary/foreground colors
 */
interface AnsiPalette {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * ANSI palettes keyed by ThemeId.
 *
 * Each palette is hand-tuned for its background:
 * - Light themes (white, paper): saturated mid-tones, dark enough to read
 * - Tinted themes (mint, sepia): colors shifted toward the tint to blend
 * - Dark theme (night): bright, vivid colors for dark backgrounds
 */
const ansiPalettes: Record<ThemeId, AnsiPalette> = {
  // ── White: clean, high-contrast on #FFFFFF (all colors ≥ 4.5:1) ──
  white: {
    black:         "#2e3436",
    red:           "#cc0000",
    green:         "#3d7a04",
    yellow:        "#8a7000",
    blue:          "#3465a4",
    magenta:       "#75507b",
    cyan:          "#047a7c",
    white:         "#767676",
    brightBlack:   "#555753",
    brightRed:     "#d42020",
    brightGreen:   "#3a8000",
    brightYellow:  "#8a7000",
    brightBlue:    "#3a6faa",
    brightMagenta: "#885088",
    brightCyan:    "#047878",
    brightWhite:   "#767676",
  },

  // ── Paper: slightly warmer tones on #EEEDED ──
  paper: {
    black:         "#2e3436",
    red:           "#c33820",
    green:         "#387204",
    yellow:        "#806800",
    blue:          "#2f5a92",
    magenta:       "#7b4d82",
    cyan:          "#086e6e",
    white:         "#595959",
    brightBlack:   "#5c5c5a",
    brightRed:     "#c03820",
    brightGreen:   "#367004",
    brightYellow:  "#806800",
    brightBlue:    "#3a6494",
    brightMagenta: "#7d4d84",
    brightCyan:    "#086c6c",
    brightWhite:   "#595959",
  },

  // ── Mint: green-shifted palette on #CCE6D0 ──
  mint: {
    black:         "#2a3832",
    red:           "#9e3020",
    green:         "#246428",
    yellow:        "#7a5c00",
    blue:          "#155878",
    magenta:       "#7b4a8a",
    cyan:          "#006464",
    white:         "#3d5240",
    brightBlack:   "#4d6054",
    brightRed:     "#a83828",
    brightGreen:   "#2a6a2e",
    brightYellow:  "#7a5c00",
    brightBlue:    "#1a6896",
    brightMagenta: "#7a4490",
    brightCyan:    "#056060",
    brightWhite:   "#3d5240",
  },

  // ── Sepia: warm earthy tones on #F9F0DB ──
  sepia: {
    black:         "#3e3328",
    red:           "#b5421a",
    green:         "#4a6818",
    yellow:        "#7a5c00",
    blue:          "#4a6a8a",
    magenta:       "#8a5470",
    cyan:          "#1e645e",
    white:         "#5e5345",
    brightBlack:   "#6b5d4f",
    brightRed:     "#b04828",
    brightGreen:   "#4e7018",
    brightYellow:  "#886200",
    brightBlue:    "#3e6490",
    brightMagenta: "#8a5470",
    brightCyan:    "#267a6e",
    brightWhite:   "#5e5345",
  },

  // ── Night: vivid colors on #23262B ──
  night: {
    black:         "#1a1d22",
    red:           "#f85149",
    green:         "#3fb950",
    yellow:        "#d29922",
    blue:          "#58a6ff",
    magenta:       "#bc8cff",
    cyan:          "#39c5cf",
    white:         "#b1bac4",
    brightBlack:   "#484f58",
    brightRed:     "#ff7b72",
    brightGreen:   "#56d364",
    brightYellow:  "#e3b341",
    brightBlue:    "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan:    "#56d4dd",
    brightWhite:   "#f0f6fc",
  },
};

/** Build a complete xterm.js ITheme from the current app theme. */
export function buildXtermTheme(): ITheme {
  const themeId = useSettingsStore.getState().appearance.theme;
  return buildXtermThemeForId(themeId);
}

/** Build a complete xterm.js ITheme for a specific theme ID. */
export function buildXtermThemeForId(themeId: ThemeId): ITheme {
  // Guard against corrupted persisted theme — fall back to paper
  const colors = themes[themeId] ?? themes.paper;
  const isDark = themeId === "night";
  const ansi = ansiPalettes[themeId] ?? ansiPalettes.paper;

  return {
    // Base colors
    background:           colors.background,
    foreground:           colors.foreground,
    cursor:               colors.foreground,
    cursorAccent:         colors.background,
    selectionBackground:  colors.selection ?? "rgba(0,102,204,0.25)",

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

    // Scrollbar
    scrollbarSliderBackground: isDark
      ? "rgba(255,255,255,0.12)"
      : "rgba(0,0,0,0.10)",
    scrollbarSliderHoverBackground: isDark
      ? "rgba(255,255,255,0.20)"
      : "rgba(0,0,0,0.18)",
    scrollbarSliderActiveBackground: isDark
      ? "rgba(255,255,255,0.30)"
      : "rgba(0,0,0,0.25)",
  };
}
