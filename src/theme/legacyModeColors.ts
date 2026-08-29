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
 * Dark mode color FALLBACKS, derived from the `night` typed theme. Values
 * that are structurally available (semantic, alert, bg/text scales) read
 * straight from `night`; values that intentionally diverge live in
 * `night.color.legacy`.
 *
 * Since WI-UI1.1 this table is a fallback for a FUTURE dark theme that omits
 * an optional key — the six shipped themes provide every projected family
 * through the adapter, and `legacyModeColors.test.ts` pins that. The old
 * "warning/subtle/contrast-text intentionally absent — behavior preserved"
 * quirk is gone: preserving it meant dark themes rendered :root's light
 * literals (#9a6700 warning at 3.1:1 on night).
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
  // overrides. The strong tint mirrors what index.css's --hover-bg-dark
  // declares for the base tint (its old --hover-bg-dark-strong sibling had
  // zero consumers and was deleted in WI-UI0.2).
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
    "--control-border": colors.controlBorder ?? colors.border,
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

/**
 * Values that are MODE-structural rather than per-theme: identical for every
 * theme of a mode, not worth a catalog field. `--warning-bg-hover/-active`
 * are slated for deletion in WI-UI4.10; `--block-bg-subtle` is an alias-debt
 * pair the same WI resolves.
 */
const MODE_STATIC = {
  light: {
    "--warning-bg-hover": "rgba(245, 158, 11, 0.15)",
    "--warning-bg-active": "rgba(245, 158, 11, 0.2)",
    "--block-bg-subtle": "rgba(0, 0, 0, 0.02)",
    "--block-bg-subtle-hover": "rgba(0, 0, 0, 0.04)",
  },
  dark: {
    "--warning-bg-hover": "rgba(245, 158, 11, 0.15)",
    "--warning-bg-active": "rgba(245, 158, 11, 0.2)",
    "--block-bg-subtle": "rgba(255, 255, 255, 0.03)",
    "--block-bg-subtle-hover": "rgba(255, 255, 255, 0.05)",
  },
} as const;

/** Compute mode-specific (dark/light) color CSS vars. Pure — no DOM access.
 *  Returns the vars plus a `__isDark` flag for class toggling.
 *
 *  WI-UI1.1 (R2 — theme-keyed emission): BOTH branches emit the SAME key set.
 *  `isDark` selects the fallback table and the class, never which keys exist —
 *  the old asymmetry left dark themes rendering :root's light `--warning-color`
 *  at 3.1:1 and left stale branch-only inline vars behind on theme switches.
 *  For the six shipped themes every value in the families the adapter projects
 *  comes from `colors` (the catalog); the fallback tables remain ONLY for a
 *  future theme that omits an optional legacy key —
 *  `legacyModeColors.test.ts` pins their unreachability today.
 */
export function computeModeColorVars(
  colors: ThemeColors,
  isDark: boolean
): ModeColorResult {
  const fb = isDark ? darkModeColors : lightModeColors;
  const statics = isDark ? MODE_STATIC.dark : MODE_STATIC.light;
  return {
    __isDark: isDark,
    vars: {
      "--text-secondary": colors.textSecondary ?? fb["--text-secondary"],
      "--code-text-color": colors.codeText ?? (isDark ? colors.foreground : lightModeColors["--code-text-color"]),
      "--selection-color": colors.selection ?? fb["--selection-color"],
      "--md-char-color": colors.mdChar ?? fb["--md-char-color"],
      "--meta-content-color": colors.mdChar ?? fb["--meta-content-color"],
      "--strong-color": colors.strong ?? fb["--strong-color"],
      "--emphasis-color": colors.emphasis ?? fb["--emphasis-color"],
      "--quote-text": colors.quoteText ?? colors.textSecondary ?? fb["--text-secondary"],
      "--blur-text-color": colors.blurText ?? fb["--blur-text-color"],
      "--bg-tertiary": colors.bgTertiary ?? (isDark ? darkModeColors["--bg-tertiary"] : colors.border),
      "--text-tertiary": colors.textTertiary ?? fb["--text-tertiary"],
      "--accent-bg": colors.accentBg ?? fb["--accent-bg"],
      "--source-mode-bg": colors.sourceModeBg ?? fb["--source-mode-bg"],
      "--error-color": colors.errorColor ?? fb["--error-color"],
      "--error-color-hover": colors.errorColorHover ?? fb["--error-color-hover"],
      "--error-bg": colors.errorBg ?? fb["--error-bg"],
      "--success-color": colors.successColor ?? fb["--success-color"],
      "--success-color-hover": colors.successColorHover ?? fb["--success-color-hover"],
      "--warning-color": colors.warningColor ?? lightModeColors["--warning-color"],
      "--warning-bg": colors.warningBg ?? lightModeColors["--warning-bg"],
      "--warning-border": colors.warningBorder ?? lightModeColors["--warning-border"],
      "--warning-bg-hover": statics["--warning-bg-hover"],
      "--warning-bg-active": statics["--warning-bg-active"],
      "--contrast-text": colors.contrastText ?? lightModeColors["--contrast-text"],
      "--subtle-bg": colors.subtleBg ?? lightModeColors["--subtle-bg"],
      "--subtle-bg-hover": colors.subtleBgHover ?? lightModeColors["--subtle-bg-hover"],
      "--hover-bg": colors.hoverBg ?? fb["--hover-bg"],
      "--hover-bg-strong": colors.hoverBgStrong ?? fb["--hover-bg-strong"],
      "--alert-note": colors.alertNote ?? fb["--alert-note"],
      "--alert-tip": colors.alertTip ?? fb["--alert-tip"],
      "--alert-important": colors.alertImportant ?? fb["--alert-important"],
      "--alert-warning": colors.alertWarning ?? fb["--alert-warning"],
      "--alert-caution": colors.alertCaution ?? fb["--alert-caution"],
      "--highlight-bg": colors.highlightBg ?? fb["--highlight-bg"],
      "--highlight-text": colors.highlightText ?? fb["--highlight-text"],
      "--block-bg-subtle": colors.blockBgSubtle ?? statics["--block-bg-subtle"],
      "--block-bg-subtle-hover": colors.blockBgSubtleHover ?? statics["--block-bg-subtle-hover"],
    },
  };
}
