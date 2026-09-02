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

import type { SyntaxPalette, AnsiPalette } from "./palettes";

/** The dark-mode-only legacy override fragment (night/solarized author it;
 *  a light theme has nothing to override — the light statics are shared).
 *  Deliberately NOT exported: theme files satisfy it structurally through
 *  the ThemeTokens dark arm, and no module names it. */
interface LegacyDarkOverrides {
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
}

type ThemeTokensBase = {
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
    /** Text painted ON accent-coloured fills (primary buttons, badges).
     *  WI-UI1.1: per theme — `white` was tuned for the saturated light
     *  accents and measured 2.53:1 on night's pastel #58a6ff. */
    contrastText: string;
    border: string;
    /** D8 (WI-UI1.2) — the boundary that makes a CONTROL findable: ≥ 3:1 on
     *  bg.primary and bg.secondary per theme. `border` stays a hairline
     *  divider (1.0–1.5:1 by design) — one token could not serve both roles,
     *  which is how every button boundary ended up invisible. */
    controlBorder: string;
    selection: string;
    /** The quiet surface tier (list rows, code-adjacent chrome). Black tints
     *  on light themes, white tints on dark — a black tint over a dark bg
     *  measured 1.01:1, i.e. invisible (WI-UI1.1). */
    subtle: { bg: string; bgHover: string };
    /** Hover feedback tints — mode-structural like `subtle`. */
    hover: { bg: string; strong: string };
    /** Blockquote body ink (WI-UI1.3). Defaults to `text.secondary` — the
     *  quote is READABLE PROSE, not syntax decoration; it used to ride
     *  `--md-char-color` and rendered 3.83:1 grey on paper and syntax GREEN
     *  on night. A theme may state its own value. */
    quoteText?: string;
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
      /** Border tint for warning surfaces — per theme since WI-UI1.1 so dark
       *  themes stop inheriting the light rgba. */
      warningBorder: string;
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
    legacy?: LegacyDarkOverrides;
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
    /** xterm's `drawBoldTextInBrightColors` (default true). Set FALSE when a
     *  bright slot doubles as a text tier — canonical Solarized maps bright
     *  8–15 to its base tones, so repainting bold in "bright" rendered `ls`
     *  output as body grey (WI-UI1.4/D10). */
    boldTextInBrightColors?: boolean;
    // `selectionBackground` and `scrollbar` were DELETED in WI-UI1.4: both are
    // DERIVED in buildXtermTheme (selection = color.selection at canvas alpha
    // .25; scrollbar = text.primary at .2/.4/.5, xterm's own rule) so the
    // terminal and the app cannot disagree about either.
  };
  syntax: SyntaxPalette;
  space: Record<1 | 2 | 3 | 4 | 5 | 6 | 8 | 10, string>;
  radius: { sm: string; md: string; lg: string; pill: string };
  shadow: { sm: string; md: string; popup: string };
  font: { sans: string; mono: string; ui: string };
};

/**
 * The theme contract — a DISCRIMINATED UNION on `isDark` (WI-UI4.10): a dark
 * theme MUST author its `color.legacy` overrides, because the fallbacks it
 * would otherwise inherit are night's values, and a third dark theme falling
 * through to another theme's ink is exactly the silent-misclassification bug
 * the `isDark` field was created to kill. Light themes stay optional — the
 * shared light statics cover them.
 */
export type ThemeTokens =
  | (ThemeTokensBase & { isDark: false })
  | (ThemeTokensBase & {
      isDark: true;
      color: ThemeTokensBase["color"] & { legacy: LegacyDarkOverrides };
    });

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
  radius: { sm: "3px", md: "5px", lg: "8px", pill: "100px" } satisfies ThemeTokens["radius"],
  font: {
    // R3 (WI-UI2.1): sans/mono mirror buildFontStack's system output — the old
    // "SauceCodePro NF" stack was one the runtime never produced. `ui` is the
    // chrome face, untouched by settings.
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    mono: 'ui-monospace, monospace',
    ui: 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
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
  // A 10%-black shadow is invisible on a dark page (WI-UI3.6); applyTheme
  // writes these INLINE, which outranks any .dark-theme class rule — so the
  // dark value must live HERE, not only in index.css (Codex #9, WI-UI3.7
  // review).
  sm: "0 1px 3px rgba(0, 0, 0, 0.4)",
  popup: "0 4px 12px rgba(0, 0, 0, 0.4)",
};

// The shared `semanticLight`/`alertLight`/`mediaLight` fragments are GONE
// (WI-UI1.2): they were shared by IDENTITY, not by verified contrast — one
// GitHub-derived palette tuned for #ffffff served four papers spanning
// L 0.74–1.0 and failed AA on three of them. Each light theme now authors its
// own blocks, with scripts/check-theme-contrast.ts as the arbiter — the same
// precedent the per-theme terminal ANSI palettes set.

/** Subtle-surface tints — black over light papers, white over dark ones.
 *  Shared per MODE (an alpha tint composites correctly over any bg of its
 *  mode), unlike the colour fragments WI-UI1.2 unshares. */
export const subtleLight: ThemeTokens["color"]["subtle"] = {
  // 3%/4% — a 2% wash on paper's grey card measured ~1.02:1, below
  // perception (audit 20260901, WI-UA5). index.css statics mirror these.
  bg: "rgba(0, 0, 0, 0.03)",
  bgHover: "rgba(0, 0, 0, 0.04)",
};

export const subtleDark: ThemeTokens["color"]["subtle"] = {
  bg: "rgba(255, 255, 255, 0.04)",
  bgHover: "rgba(255, 255, 255, 0.06)",
};

/** Hover feedback tints — same mode-structural sharing as `subtle`. */
export const hoverLight: ThemeTokens["color"]["hover"] = {
  // 6% base — 4% was below perception on grey surfaces (WI-UA5, as above).
  bg: "rgba(0, 0, 0, 0.06)",
  strong: "rgba(0, 0, 0, 0.08)",
};

export const hoverDark: ThemeTokens["color"]["hover"] = {
  bg: "rgba(255, 255, 255, 0.08)",
  strong: "rgba(255, 255, 255, 0.12)",
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
  "--hover-bg": "rgba(0, 0, 0, 0.06)",
  "--hover-bg-strong": "rgba(0, 0, 0, 0.08)",
  "--subtle-bg": "rgba(0, 0, 0, 0.03)",
  "--subtle-bg-hover": "rgba(0, 0, 0, 0.04)",
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
