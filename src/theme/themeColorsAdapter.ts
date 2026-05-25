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
}

const DARK_THEMES = new Set<ThemeId>(["night"]);

/** Project a ThemeTokens into the legacy ThemeColors surface. */
export function themeTokensToColors(id: ThemeId, t: ThemeTokens): ThemeColors {
  const out: ThemeColors = {
    background: t.color.bg.primary,
    foreground: t.color.text.primary,
    link: t.color.accent.primary,
    secondary: t.color.bg.secondary,
    border: t.color.border,
    strong: t.color.strong,
    emphasis: t.color.emphasis,
  };
  if (DARK_THEMES.has(id)) {
    out.isDark = true;
    out.textSecondary = t.color.text.secondary;
    out.selection = t.color.selection;
    // Audit fix (H2, 2026-05-25): codeText/mdChar were previously
    // hardcoded here. They now live on the typed source as
    // ThemeTokens.color.legacy on the dark theme, so retinting a dark
    // theme is a one-file edit per the architecture promise.
    out.codeText = t.color.legacy?.codeText;
    out.mdChar = t.color.legacy?.mdChar;
  }
  return out;
}

/** Computed ThemeColors record for all 5 vmark themes, derived from
 *  the typed ThemeTokens. Replaces the hand-written const in
 *  settingsStore.ts. */
export const themesAsColors: Record<ThemeId, ThemeColors> = {
  white: themeTokensToColors("white", themes.white),
  paper: themeTokensToColors("paper", themes.paper),
  mint:  themeTokensToColors("mint",  themes.mint),
  sepia: themeTokensToColors("sepia", themes.sepia),
  night: themeTokensToColors("night", themes.night),
};
