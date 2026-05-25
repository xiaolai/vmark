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
    /**
     * Legacy `ThemeColors`-shape fields preserved so the adapter at
     * `themeColorsAdapter.ts` can project them through without const-
     * folding. Only dark themes populate `codeText`/`mdChar` today
     * (originally night-only); leave optional so light themes can omit.
     */
    legacy?: {
      codeText?: string;
      mdChar?: string;
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

/**
 * Light-theme `color.semantic` block — identical across white / paper /
 * mint / sepia. Extracted to keep "the warning color changed" a one-file
 * edit instead of four. Night overrides this with its own dark values.
 */
export const semanticLight: ThemeTokens["color"]["semantic"] = {
  error: "#cf222e",
  errorBg: "#ffebe9",
  errorHover: "#b91c1c",
  warning: "#9a6700",
  warningBg: "rgba(245, 158, 11, 0.1)",
  success: "#16a34a",
  successHover: "#15803d",
};

/** Light-theme `color.alert` block — identical across 4 light themes. */
export const alertLight: ThemeTokens["color"]["alert"] = {
  note: "#0969da",
  tip: "#1a7f37",
  important: "#8250df",
  warning: "#9a6700",
  caution: "#cf222e",
};

/** Light-theme `color.media` block — identical across all light themes. */
export const mediaLight: ThemeTokens["color"]["media"] = {
  video: "#0d9488",
  audio: "#6366f1",
  youtube: "#dc2626",
  vimeo: "#00adef",
  bilibili: "#fb7299",
};

// Legacy lightTheme / darkTheme aliases now live in `./index.ts` (and
// indirectly via the themes/ barrel) — they can't live here because
// tokens.ts is itself imported by themes/*.ts, and forwarding the
// concrete theme values from this file would create a circular
// evaluation: tokens.ts → themes/paper.ts → tokens.ts.
