/**
 * Returns true when the active appearance theme is a dark theme.
 *
 * Reactive — re-renders the caller when the user switches theme, and when
 * the OS light/dark preference flips while follow-system-appearance is on
 * (#1125). The dark/light determination is the same `themes[id].isDark`
 * flag the `useTheme` hook uses to toggle the `.dark-theme` class on the
 * root.
 *
 * Use for components that need to swap a non-CSS-driven library style
 * (e.g. react-json-view-lite's `defaultStyles` vs `darkStyles`).
 * Components that style themselves through CSS variables don't need
 * this — the variables already swap on the `.dark-theme` class.
 *
 * @coordinates-with stores/settingsStore.ts — themes registry
 * @coordinates-with hooks/useEffectiveTheme.ts — manual vs follow-system resolution
 * @coordinates-with hooks/useTheme.ts — toggles the .dark-theme class
 * @module hooks/useIsDarkTheme
 */

import { themes } from "@/stores/settingsStore";
import { useEffectiveThemeId } from "@/hooks/useEffectiveTheme";

export function useIsDarkTheme(): boolean {
  const themeId = useEffectiveThemeId();
  return themes[themeId]?.isDark ?? false;
}
