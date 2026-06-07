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
  // audit-fix — derive isDark from catalog
  /**
   * Whether this theme is dark. The single source of truth for dark/light
   * classification — `themeColorsAdapter.ts` reads this instead of holding a
   * second hardcoded `DARK_THEMES` set, so adding another dark theme can't
   * silently misclassify it.
   */
  isDark: boolean;
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
     * Legacy CSS-var override values that the runtime `useTheme.ts` adapter
     * emits under the historical (non-`--color-*`) var names — the names the
     * app's CSS actually consumes (`--accent-bg`, `--blur-text-color`, …).
     *
     * These are NOT derivable from the structured fields above because they
     * intentionally diverge (e.g. night's `--accent-bg` is `rgba(90,168,255,…)`
     * while `color.accent.bg` is `rgba(88,166,255,…)`, and night's
     * `--error-color-hover` differs from `color.semantic.errorHover`). Holding
     * them here keeps the typed catalog the single source of truth per
     * ADR-014 — `useTheme.ts` reads these instead of carrying its own
     * standalone `darkModeColors` const.
     *
     * `codeText`/`mdChar` are also projected by `themeColorsAdapter.ts` into
     * the legacy `ThemeColors` surface. The rest are dark-mode-only override
     * values; light themes leave them undefined (light shares one static
     * fragment — see `legacyDarkExtra` / the light branch in `useTheme.ts`).
     */
    legacy?: {
      codeText?: string;
      mdChar?: string;
      /** Dark-mode-only `--*` override values (night). */
      blurText?: string;
      accentBg?: string;
      sourceModeBg?: string;
      errorColorHover?: string;
      successColorHover?: string;
      highlightBg?: string;
      highlightText?: string;
      blockBgSubtle?: string;
      blockBgSubtleHover?: string;
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

/**
 * Legacy light-mode CSS-var override values, emitted under the historical
 * `--*` names that the app's CSS consumes. Identical across all four light
 * themes (white / paper / mint / sepia), so it lives here once rather than
 * per-theme. `useTheme.ts`'s light branch reads this instead of carrying a
 * standalone `lightModeColors` const — keeping `src/theme/` the single
 * source of truth (ADR-014).
 *
 * Per-theme light values (`--text-secondary`, `--strong-color`, etc.) are
 * NOT here — those come from each theme's structured fields. This fragment
 * is only the genuinely-shared static overrides.
 */
export const legacyLight = {
  "--text-secondary": "#666666",
  "--code-text-color": "#1a1a1a",
  "--selection-color": "rgba(0, 102, 204, 0.2)",
  "--md-char-color": "#777777",
  "--meta-content-color": "#777777",
  "--strong-color": "rgb(63, 86, 99)",
  "--emphasis-color": "rgb(91, 4, 17)",
  "--blur-text-color": "#c8c8c8",
  "--text-tertiary": "#999999",
  "--accent-bg": "rgba(0, 102, 204, 0.1)",
  "--source-mode-bg": "rgba(0, 0, 0, 0.02)",
  "--error-color": "#cf222e",
  "--error-color-hover": "#b91c1c",
  "--error-bg": "#ffebe9",
  "--success-color": "#16a34a",
  "--success-color-hover": "#15803d",
  "--warning-color": "#9a6700",
  "--warning-bg": "rgba(245, 158, 11, 0.1)",
  "--warning-border": "rgba(245, 158, 11, 0.3)",
  "--warning-bg-hover": "rgba(245, 158, 11, 0.15)",
  "--warning-bg-active": "rgba(245, 158, 11, 0.2)",
  "--contrast-text": "white",
  "--hover-bg": "rgba(0, 0, 0, 0.04)",
  "--hover-bg-strong": "rgba(0, 0, 0, 0.08)",
  "--subtle-bg": "rgba(0, 0, 0, 0.02)",
  "--subtle-bg-hover": "rgba(0, 0, 0, 0.03)",
  "--alert-note": "#0969da",
  "--alert-tip": "#1a7f37",
  "--alert-important": "#8250df",
  "--alert-warning": "#9a6700",
  "--alert-caution": "#cf222e",
  "--highlight-bg": "#fff3a3",
  "--highlight-text": "inherit",
} as const;

// Legacy lightTheme / darkTheme aliases now live in `./index.ts` (and
// indirectly via the themes/ barrel) — they can't live here because
// tokens.ts is itself imported by themes/*.ts, and forwarding the
// concrete theme values from this file would create a circular
// evaluation: tokens.ts → themes/paper.ts → tokens.ts.
