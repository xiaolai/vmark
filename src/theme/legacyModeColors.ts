/**
 * Legacy mode color derivation
 *
 * Purpose: Derives the light/dark "legacy" CSS-var value sets (the
 * `--bg-color` / `--accent-bg` names the app's CSS actually consumes) from
 * the typed theme catalog, plus the pure core/mode color-var computation
 * used by `useTheme`. Extracted from `hooks/useTheme.ts` to keep that file
 * under the size gate; ADR-014: `src/theme/` is the single source of truth
 * for color values.
 *
 * @coordinates-with hooks/useTheme.ts — sole runtime consumer (re-exports for tests)
 * @coordinates-with tokens.ts, themes/night.ts — source of the derived values
 * @module theme/legacyModeColors
 */

import { legacyLight } from "./tokens";
import { night } from "./themes/night";
import type { ThemeColors } from "./themeColorsAdapter";

/**
 * Light mode color defaults — re-exported from the typed catalog
 * (`legacyLight` in `src/theme/tokens.ts`). Identical across all light
 * themes, so it lives once in the catalog layer rather than being
 * hand-maintained here.
 */
const lightModeColors = legacyLight;

/**
 * Dark mode color defaults, derived from the `night` typed theme. Values that
 * are structurally available (semantic, alert, bg/text scales) read straight
 * from `night`; values that intentionally diverge from the structured fields
 * live in `night.color.legacy` (see that file's comment). This keeps the
 * emitted `--*` vars byte-identical to the historical literals while making
 * the typed catalog the single source of truth.
 *
 * Note: `--warning-*`, `--subtle-bg*`, and `--contrast-text` are
 * intentionally absent — the dark branch of `computeModeColorVars` never
 * emitted them (dark mode inherits the light/`:root` values for those), and
 * that behavior is preserved. `--hover-bg`/`--hover-bg-strong` ARE emitted
 * since audit 20260612 H15 — the inherited light tints were near-invisible
 * on dark backgrounds.
 */
const nightLegacy = night.color.legacy ?? {};
const darkModeColors = {
  "--text-secondary": night.color.text.secondary,
  "--code-text-color": nightLegacy.codeText ?? night.color.text.primary,
  "--selection-color": night.color.selection,
  "--md-char-color": nightLegacy.mdChar ?? "#6a9955",
  "--meta-content-color": nightLegacy.mdChar ?? "#6a9955",
  "--strong-color": night.color.strong,
  "--emphasis-color": night.color.emphasis,
  "--blur-text-color": nightLegacy.blurText ?? "#6b7078",
  "--bg-tertiary": night.color.bg.tertiary,
  "--text-tertiary": night.color.text.tertiary,
  "--accent-bg": nightLegacy.accentBg ?? night.color.accent.bg,
  "--source-mode-bg": nightLegacy.sourceModeBg ?? "rgba(255, 255, 255, 0.02)",
  "--error-color": night.color.semantic.error,
  "--error-color-hover": nightLegacy.errorColorHover ?? night.color.semantic.errorHover,
  "--error-bg": night.color.semantic.errorBg,
  // Success states (adjusted for dark mode)
  "--success-color": night.color.semantic.success,
  "--success-color-hover": nightLegacy.successColorHover ?? night.color.semantic.successHover,
  // Alert block colors (lighter for dark mode)
  "--alert-note": night.color.alert.note,
  "--alert-tip": night.color.alert.tip,
  "--alert-important": night.color.alert.important,
  "--alert-warning": night.color.alert.warning,
  "--alert-caution": night.color.alert.caution,
  // Highlight mark (darker background for dark mode)
  "--highlight-bg": nightLegacy.highlightBg ?? "#5c5c00",
  "--highlight-text": nightLegacy.highlightText ?? "#fff3a3",
  // Hover feedback (audit 20260612 H15): dark mode previously inherited the
  // light rgba(0,0,0,…) tints — a black tint on a dark background is barely
  // perceivable, and only 17 of 40+ consumers carried manual per-file
  // overrides. Values mirror --hover-bg-dark/--hover-bg-dark-strong in
  // index.css.
  "--hover-bg": "rgba(255, 255, 255, 0.08)",
  "--hover-bg-strong": "rgba(255, 255, 255, 0.12)",
};

/** Compute core theme color CSS vars. Pure — no DOM access. */
export function computeCoreColorVars(colors: ThemeColors): Record<string, string> {
  return {
    "--bg-color": colors.background,
    "--text-color": colors.foreground,
    "--primary-color": colors.link,
    "--bg-secondary": colors.secondary,
    "--border-color": colors.border,
    "--accent-primary": colors.link,
    "--accent-text": colors.link,
    "--sidebar-bg": colors.secondary,
    "--code-bg-color": colors.secondary,
    "--code-border-color": colors.border,
    "--table-border-color": colors.border,
  };
}

export type ModeColorResult = {
  __isDark: boolean;
  vars: Record<string, string>;
};

/** Compute mode-specific (dark/light) color CSS vars. Pure — no DOM access.
 *  Returns the vars plus a `__isDark` flag for class toggling. */
export function computeModeColorVars(
  colors: ThemeColors,
  isDark: boolean
): ModeColorResult {
  if (isDark) {
    return {
      __isDark: true,
      vars: {
        "--text-secondary": colors.textSecondary ?? darkModeColors["--text-secondary"],
        "--code-text-color": colors.codeText ?? colors.foreground,
        "--selection-color": colors.selection ?? darkModeColors["--selection-color"],
        "--md-char-color": colors.mdChar ?? darkModeColors["--md-char-color"],
        "--meta-content-color": colors.mdChar ?? darkModeColors["--meta-content-color"],
        "--strong-color": colors.strong ?? darkModeColors["--strong-color"],
        "--emphasis-color": colors.emphasis ?? darkModeColors["--emphasis-color"],
        "--blur-text-color": colors.blurText ?? darkModeColors["--blur-text-color"],
        "--bg-tertiary": colors.bgTertiary ?? darkModeColors["--bg-tertiary"],
        "--text-tertiary": colors.textTertiary ?? darkModeColors["--text-tertiary"],
        "--accent-bg": colors.accentBg ?? darkModeColors["--accent-bg"],
        "--source-mode-bg": colors.sourceModeBg ?? darkModeColors["--source-mode-bg"],
        "--error-color": colors.errorColor ?? darkModeColors["--error-color"],
        "--error-color-hover": colors.errorColorHover ?? darkModeColors["--error-color-hover"],
        "--error-bg": colors.errorBg ?? darkModeColors["--error-bg"],
        "--success-color": colors.successColor ?? darkModeColors["--success-color"],
        "--success-color-hover": colors.successColorHover ?? darkModeColors["--success-color-hover"],
        // Alert block colors
        "--alert-note": colors.alertNote ?? darkModeColors["--alert-note"],
        "--alert-tip": colors.alertTip ?? darkModeColors["--alert-tip"],
        "--alert-important": colors.alertImportant ?? darkModeColors["--alert-important"],
        "--alert-warning": colors.alertWarning ?? darkModeColors["--alert-warning"],
        "--alert-caution": colors.alertCaution ?? darkModeColors["--alert-caution"],
        // Highlight mark
        "--highlight-bg": colors.highlightBg ?? darkModeColors["--highlight-bg"],
        "--highlight-text": colors.highlightText ?? darkModeColors["--highlight-text"],
        // Subtle block background for dark mode (light overlay)
        "--block-bg-subtle": colors.blockBgSubtle ?? nightLegacy.blockBgSubtle ?? "rgba(255, 255, 255, 0.03)",
        "--block-bg-subtle-hover": colors.blockBgSubtleHover ?? nightLegacy.blockBgSubtleHover ?? "rgba(255, 255, 255, 0.05)",
        // Hover feedback — white tints; inherited light black tints were
        // near-invisible on dark backgrounds (audit 20260612 H15)
        "--hover-bg": darkModeColors["--hover-bg"],
        "--hover-bg-strong": darkModeColors["--hover-bg-strong"],
      },
    };
  }
  return {
    __isDark: false,
    vars: {
      ...lightModeColors,
      // Use theme-specific optional colors if defined, fallback to defaults
      "--text-secondary": colors.textSecondary ?? lightModeColors["--text-secondary"],
      "--code-text-color": colors.codeText ?? lightModeColors["--code-text-color"],
      "--selection-color": colors.selection ?? lightModeColors["--selection-color"],
      "--md-char-color": colors.mdChar ?? lightModeColors["--md-char-color"],
      "--meta-content-color": colors.mdChar ?? lightModeColors["--meta-content-color"],
      "--strong-color": colors.strong ?? lightModeColors["--strong-color"],
      "--emphasis-color": colors.emphasis ?? lightModeColors["--emphasis-color"],
      // Use theme's border color for bg-tertiary to harmonize with colored themes
      "--bg-tertiary": colors.border,
      // Subtle block background for light mode (dark overlay)
      "--block-bg-subtle": "rgba(0, 0, 0, 0.02)",
      "--block-bg-subtle-hover": "rgba(0, 0, 0, 0.04)",
    },
  };
}
