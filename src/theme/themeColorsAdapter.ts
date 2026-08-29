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

/** Legacy ThemeColors shape — canonical definition (settingsTypes re-exports it). */
export interface ThemeColors {
  background: string;
  foreground: string;
  link: string;
  secondary: string;
  border: string;
  /** D8 (WI-UI1.2) — the ≥3:1 control boundary; `border` stays a divider. */
  controlBorder?: string;
  isDark?: boolean;
  textSecondary?: string;
  codeText?: string;
  selection?: string;
  mdChar?: string;
  strong?: string;
  emphasis?: string;
  // WI-UI1.1 — projected for EVERY theme (isDark no longer chooses colours):
  contrastText?: string;
  warningColor?: string;
  warningBg?: string;
  warningBorder?: string;
  quoteText?: string;
  subtleBg?: string;
  subtleBgHover?: string;
  hoverBg?: string;
  hoverBgStrong?: string;
  // Legacy `--*` overrides, projected from ThemeTokens so each theme renders
  // its own values. useTheme.ts reads these with a night fallback (kept for a
  // future dark theme that omits a key).
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

/**
 * Copy a legacy override across only when the theme actually states one.
 *
 * `t.color.legacy` is optional per theme, so `legacy?.x` yields `undefined`
 * for "this theme states no override". That is an ABSENT key, not a stated
 * empty value: `useTheme.ts` falls back to the night defaults for keys the
 * theme does not carry, and writing the key with `undefined` would claim the
 * theme had spoken.
 */
function setIfStated<K extends keyof ThemeColors>(
  out: ThemeColors,
  key: K,
  value: ThemeColors[K] | undefined
): void {
  if (value !== undefined) out[key] = value;
}

// audit-fix — derive isDark from catalog
/** Project a ThemeTokens into the legacy ThemeColors surface.
 *  Exported for `scripts/check-theme-contrast.ts`, which measures synthetic
 *  themes through the SAME projection the runtime uses — a private copy in the
 *  gate would drift from this one. */
export function themeTokensToColors(t: ThemeTokens): ThemeColors {
  // WI-UI1.1 — every value below is projected for EVERY theme, so the legacy
  // writer's isDark branch chooses a CLASS, never a colour. Before this, the
  // light branch discarded selection/accentBg (mint rendered the shared blue
  // tint) and the dark branch omitted the warning/contrast/subtle families
  // (night rendered :root's light literals at 3.1:1).
  const out: ThemeColors = {
    background: t.color.bg.primary,
    foreground: t.color.text.primary,
    link: t.color.accent.primary,
    secondary: t.color.bg.secondary,
    border: t.color.border,
    controlBorder: t.color.controlBorder,
    strong: t.color.strong,
    emphasis: t.color.emphasis,
    textSecondary: t.color.text.secondary,
    selection: t.color.selection,
    accentBg: t.color.accent.bg,
    textTertiary: t.color.text.tertiary,
    bgTertiary: t.color.bg.tertiary,
    contrastText: t.color.contrastText,
    warningColor: t.color.semantic.warning,
    warningBg: t.color.semantic.warningBg,
    warningBorder: t.color.semantic.warningBorder,
    quoteText: t.color.quoteText ?? t.color.text.secondary,
    subtleBg: t.color.subtle.bg,
    subtleBgHover: t.color.subtle.bgHover,
    hoverBg: t.color.hover.bg,
    hoverBgStrong: t.color.hover.strong,
    errorColor: t.color.semantic.error,
    errorColorHover: t.color.semantic.errorHover,
    errorBg: t.color.semantic.errorBg,
    successColor: t.color.semantic.success,
    successColorHover: t.color.semantic.successHover,
    alertNote: t.color.alert.note,
    alertTip: t.color.alert.tip,
    alertImportant: t.color.alert.important,
    alertWarning: t.color.alert.warning,
    alertCaution: t.color.alert.caution,
  };
  // Audit fix (H2, 2026-05-25): codeText/mdChar live on ThemeTokens.color.legacy
  // (dark themes state them; light themes share the static fragment).
  setIfStated(out, "codeText", t.color.legacy?.codeText);
  setIfStated(out, "mdChar", t.color.legacy?.mdChar);
  setIfStated(out, "blurText", t.color.legacy?.blurText);
  setIfStated(out, "sourceModeBg", t.color.legacy?.sourceModeBg);
  setIfStated(out, "highlightBg", t.color.legacy?.highlightBg);
  setIfStated(out, "highlightText", t.color.legacy?.highlightText);
  setIfStated(out, "blockBgSubtle", t.color.legacy?.blockBgSubtle);
  setIfStated(out, "blockBgSubtleHover", t.color.legacy?.blockBgSubtleHover);
  if (t.isDark) out.isDark = true;
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
