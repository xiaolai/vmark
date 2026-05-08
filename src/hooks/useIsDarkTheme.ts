/**
 * Returns true when the active appearance theme is a dark theme.
 *
 * Reactive — re-renders the caller when the user switches theme. The
 * dark/light determination is the same `themes[id].isDark` flag the
 * `useTheme` hook uses to toggle the `.dark-theme` class on the root.
 *
 * Use for components that need to swap a non-CSS-driven library style
 * (e.g. react-json-view-lite's `defaultStyles` vs `darkStyles`).
 * Components that style themselves through CSS variables don't need
 * this — the variables already swap on the `.dark-theme` class.
 *
 * @coordinates-with stores/settingsStore.ts — themes registry
 * @coordinates-with hooks/useTheme.ts — toggles the .dark-theme class
 * @module hooks/useIsDarkTheme
 */

import { useSettingsStore, themes } from "@/stores/settingsStore";

export function useIsDarkTheme(): boolean {
  return useSettingsStore(
    (state) => themes[state.appearance.theme]?.isDark ?? false,
  );
}
