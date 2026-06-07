/**
 * Adapter: ThemeTokens → legacy ThemeColors shape.
 *
 * The settingsStore.themes catalog has historically returned a flat
 * ThemeColors record. Post theme-unification-2026-05 the typed source
 * of truth is ThemeTokens in src/theme/themes/. This adapter projects
 * a ThemeTokens value back into the ThemeColors surface so consumers
 * (useTheme.ts, useIsDarkTheme.ts) need no change.
 *
 * @module theme/themeColorsAdapter
 */

import type { ThemeTokens } from "./tokens";
import type { ThemeId } from "./themes";
import { themes } from "./themes";

/** Legacy ThemeColors shape (mirrored from settingsTypes.ts). */
export interface ThemeColors {
  background: string;
  foreground: string;
  link: string;
  secondary: string;
  border: string;
  isDark?: boolean;
  textSecondary?: string;
  codeText?: string;
  selection?: string;
  mdChar?: string;
  strong?: string;
  emphasis?: string;
  // Dark-mode-only legacy `--*` overrides, projected from
  // ThemeTokens.color.legacy so each dark theme renders its own values
  // (not night's). useTheme.ts reads these with a night fallback.
  bgTertiary?: string;
  textTertiary?: string;
  blurText?: string;
  accentBg?: string;
  sourceModeBg?: string;
  errorColor?: string;
  errorColorHover?: string;
  errorBg?: string;
  successColor?: string;
  successColorHover?: string;
  alertNote?: string;
  alertTip?: string;
  alertImportant?: string;
  alertWarning?: string;
  alertCaution?: string;
  highlightBg?: string;
  highlightText?: string;
  blockBgSubtle?: string;
  blockBgSubtleHover?: string;
}

// audit-fix — derive isDark from catalog
/** Project a ThemeTokens into the legacy ThemeColors surface. */
function themeTokensToColors(t: ThemeTokens): ThemeColors {
  const out: ThemeColors = {
    background: t.color.bg.primary,
    foreground: t.color.text.primary,
    link: t.color.accent.primary,
    secondary: t.color.bg.secondary,
    border: t.color.border,
    strong: t.color.strong,
    emphasis: t.color.emphasis,
  };
  if (t.isDark) {
    out.isDark = true;
    out.textSecondary = t.color.text.secondary;
    out.selection = t.color.selection;
    // Audit fix (H2, 2026-05-25): codeText/mdChar were previously
    // hardcoded here. They now live on the typed source as
    // ThemeTokens.color.legacy on the dark theme, so retinting a dark
    // theme is a one-file edit per the architecture promise.
    out.codeText = t.color.legacy?.codeText;
    out.mdChar = t.color.legacy?.mdChar;
    // Per-theme dark legacy overrides — so a second dark theme
    // (e.g. solarized) renders its OWN values, not night's. useTheme.ts
    // reads each with a night fallback.
    out.bgTertiary = t.color.bg.tertiary;
    out.textTertiary = t.color.text.tertiary;
    out.blurText = t.color.legacy?.blurText;
    out.accentBg = t.color.legacy?.accentBg;
    out.sourceModeBg = t.color.legacy?.sourceModeBg;
    out.errorColor = t.color.semantic.error;
    out.errorColorHover = t.color.legacy?.errorColorHover;
    out.errorBg = t.color.semantic.errorBg;
    out.successColor = t.color.semantic.success;
    out.successColorHover = t.color.legacy?.successColorHover;
    out.alertNote = t.color.alert.note;
    out.alertTip = t.color.alert.tip;
    out.alertImportant = t.color.alert.important;
    out.alertWarning = t.color.alert.warning;
    out.alertCaution = t.color.alert.caution;
    out.highlightBg = t.color.legacy?.highlightBg;
    out.highlightText = t.color.legacy?.highlightText;
    out.blockBgSubtle = t.color.legacy?.blockBgSubtle;
    out.blockBgSubtleHover = t.color.legacy?.blockBgSubtleHover;
  }
  return out;
}

/** Computed ThemeColors record for every vmark theme, derived from the
 *  typed ThemeTokens catalog. Built by mapping over `themes` so adding a
 *  theme needs no edit here — it flows straight from `themes/index.ts`. */
export const themesAsColors: Record<ThemeId, ThemeColors> = Object.fromEntries(
  (Object.keys(themes) as ThemeId[]).map((id) => [
    id,
    themeTokensToColors(themes[id]),
  ]),
) as Record<ThemeId, ThemeColors>;
