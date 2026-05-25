/**
 * Typed theme tokens — ADR-014.
 *
 * The canonical type for visual design tokens. Themes implement this type;
 * the reskin replaces a theme by providing a new `ThemeTokens` value rather
 * than editing CSS.
 *
 * After theme-unification-2026-05, `ThemeTokens` is the single source of
 * truth for app, editor, AND terminal theme colors. Adding a new vmark
 * theme requires only a new file in `src/theme/themes/`.
 *
 * @module theme/tokens
 */

/** 16-color ANSI palette consumed by the xterm.js terminal. */
export interface AnsiPalette {
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

export type ThemeTokens = {
  color: {
    bg: { primary: string; secondary: string; tertiary: string };
    text: { primary: string; secondary: string; tertiary: string };
    accent: { primary: string; bg: string };
    border: string;
    selection: string;
    /** Bold-text tint. Per-theme (e.g. "blue-gray" on paper). */
    strong: string;
    /** Italic-text tint. Per-theme (e.g. "dark wine" on paper). */
    emphasis: string;
    semantic: {
      error: string;
      errorBg: string;
      errorHover: string;
      warning: string;
      warningBg: string;
      success: string;
      successHover: string;
    };
    alert: {
      note: string;
      tip: string;
      important: string;
      warning: string;
      caution: string;
    };
    media: {
      video: string;
      audio: string;
      youtube: string;
      vimeo: string;
      bilibili: string;
    };
  };
  /**
   * Terminal-specific colors. The 16 ANSI palette flows to the xterm.js
   * `ITheme` via `buildXtermTheme()`; the scrollbar triple and cursor
   * tints are also xterm `ITheme` fields. None of these are written as
   * CSS vars by default — they are JS-side data consumed at xterm-
   * instance creation. (If a future surface needs CSS access, expose
   * via `applyTheme()` selectively.)
   */
  terminal: {
    ansi: AnsiPalette;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    scrollbar: { idle: string; hover: string; active: string };
  };
  space: Record<1 | 2 | 3 | 4 | 5 | 6 | 8 | 10, string>;
  radius: { sm: string; md: string; lg: string; pill: string };
  shadow: { sm: string; md: string; popup: string };
  font: { sans: string; mono: string };
};

// ---------------------------------------------------------------------------
// Shared static fragments — identical across themes, defined once.
// ---------------------------------------------------------------------------

/** Spatial/typographic primitives that don't vary by theme. */
export const sharedPrimitives = {
  space: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    10: "40px",
  } satisfies ThemeTokens["space"],
  radius: { sm: "4px", md: "6px", lg: "8px", pill: "100px" } satisfies ThemeTokens["radius"],
  font: {
    sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "SF Pro SC", "SF Pro Text", "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Helvetica, Arial, sans-serif',
    mono: '"SauceCodePro NF", "Courier New", Consolas, monospace',
  } satisfies ThemeTokens["font"],
} as const;

/** Shadow tokens for light themes; `night` overrides via deeper alpha. */
export const lightShadows: ThemeTokens["shadow"] = {
  sm: "0 1px 3px rgba(0, 0, 0, 0.1)",
  md: "0 2px 8px rgba(0, 0, 0, 0.12)",
  popup: "0 4px 12px rgba(0, 0, 0, 0.15)",
};

export const darkShadows: ThemeTokens["shadow"] = {
  ...lightShadows,
  popup: "0 4px 12px rgba(0, 0, 0, 0.4)",
};

// ---------------------------------------------------------------------------
// Legacy lightTheme / darkTheme — kept as paper/night aliases for the
// existing applyTheme.test.ts. New code should import named themes from
// `./themes/`.
// ---------------------------------------------------------------------------

export { paper as lightTheme } from "./themes/paper";
export { night as darkTheme } from "./themes/night";
