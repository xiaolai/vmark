/**
 * Effective Theme Resolution
 *
 * Purpose: Single source of truth for which theme id is actually in effect —
 * the manually selected theme, or (when follow-system-appearance is on) the
 * paired light/dark theme matching the current OS preference (#1125).
 *
 * Every consumer that used to read `appearance.theme` directly goes through
 * here: `useTheme`, `useIsDarkTheme`, and the terminal xterm retheming.
 * `appearance.theme` itself remains the user's manual pick and is never
 * mutated by system flips.
 *
 * Consumers remain responsible for guarding unknown ids
 * (`themes[id] ?? themes.paper`) — this module resolves, it doesn't validate.
 *
 * @coordinates-with stores/systemAppearanceStore.ts — OS dark-mode observation
 * @coordinates-with stores/settingsStore.ts — appearance preferences
 * @module hooks/useEffectiveTheme
 */

import { useSettingsStore, type AppearanceSettings } from "@/stores/settingsStore";
import { initialState } from "@/stores/settingsStore/defaults";
import { useSystemAppearanceStore } from "@/stores/systemAppearanceStore";
import type { ThemeId } from "@/theme/themes";

type EffectiveThemeInput = Pick<
  AppearanceSettings,
  "theme" | "followSystemAppearance" | "systemLightTheme" | "systemDarkTheme"
>;

/** Pure resolver — exported for testing. Missing paired ids (pre-#1125
 *  persisted blobs mid-migration) fall back to the shipped defaults. */
export function resolveEffectiveThemeId(
  appearance: EffectiveThemeInput,
  prefersDark: boolean
): ThemeId {
  if (!appearance.followSystemAppearance) return appearance.theme;
  return prefersDark
    ? (appearance.systemDarkTheme ?? initialState.appearance.systemDarkTheme)
    : (appearance.systemLightTheme ?? initialState.appearance.systemLightTheme);
}

/** Non-reactive read for callbacks and store subscribers. */
export function getEffectiveThemeId(): ThemeId {
  return resolveEffectiveThemeId(
    useSettingsStore.getState().appearance,
    useSystemAppearanceStore.getState().prefersDark
  );
}

/** Reactive effective theme id — re-renders on manual theme changes, on
 *  follow-system toggling, and on OS light/dark flips while following. */
export function useEffectiveThemeId(): ThemeId {
  const theme = useSettingsStore((s) => s.appearance.theme);
  const follow = useSettingsStore((s) => s.appearance.followSystemAppearance);
  const light = useSettingsStore((s) => s.appearance.systemLightTheme);
  const dark = useSettingsStore((s) => s.appearance.systemDarkTheme);
  const prefersDark = useSystemAppearanceStore((s) => s.prefersDark);
  return resolveEffectiveThemeId(
    { theme, followSystemAppearance: follow, systemLightTheme: light, systemDarkTheme: dark },
    prefersDark
  );
}
