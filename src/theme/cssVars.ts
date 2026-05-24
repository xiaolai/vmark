/**
 * cssVars — typed accessor for ADR-014 theme tokens.
 *
 * The typed `ThemeTokens` structure in `tokens.ts` is the source of truth
 * for values; `applyTheme()` writes them as CSS custom properties named
 * `--color-bg-primary` etc. (kebab-case, no aliasing).
 *
 * This module exposes a typed object whose leaves are `var(--…)` strings.
 * Component authors write `cssVars.color.bg.primary` in inline TSX styles
 * and get full IDE autocomplete + rename safety. The runtime value is
 * still a CSS variable, so theme switching at the document root reflects
 * everywhere instantly.
 *
 * Mirror the structure to ThemeTokens; missing entries here are mechanical
 * to add as components migrate.
 *
 * @module theme/cssVars
 */

export const cssVars = {
  color: {
    bg: {
      primary: "var(--color-bg-primary)",
      secondary: "var(--color-bg-secondary)",
      tertiary: "var(--color-bg-tertiary)",
    },
    text: {
      primary: "var(--color-text-primary)",
      secondary: "var(--color-text-secondary)",
      tertiary: "var(--color-text-tertiary)",
    },
    accent: {
      primary: "var(--color-accent-primary)",
      bg: "var(--color-accent-bg)",
    },
    border: "var(--color-border)",
    selection: "var(--color-selection)",
    semantic: {
      error: "var(--color-semantic-error)",
      errorBg: "var(--color-semantic-error-bg)",
      errorHover: "var(--color-semantic-error-hover)",
      warning: "var(--color-semantic-warning)",
      warningBg: "var(--color-semantic-warning-bg)",
      success: "var(--color-semantic-success)",
      successHover: "var(--color-semantic-success-hover)",
    },
  },
  space: {
    1: "var(--space-1)",
    2: "var(--space-2)",
    3: "var(--space-3)",
    4: "var(--space-4)",
    5: "var(--space-5)",
    6: "var(--space-6)",
    8: "var(--space-8)",
    10: "var(--space-10)",
  },
  radius: {
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
    pill: "var(--radius-pill)",
  },
  shadow: {
    sm: "var(--shadow-sm)",
    md: "var(--shadow-md)",
    popup: "var(--shadow-popup)",
  },
} as const;
