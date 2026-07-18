/**
 * System Appearance Store
 *
 * Purpose: Runtime (non-persisted) store holding whether the OS currently
 * prefers a dark color scheme. Fed by `useSystemAppearanceWatcher`
 * (mounted from `useTheme`, so every themed window keeps it live) and read
 * by the effective-theme resolution in `useEffectiveTheme`.
 *
 * Key decisions:
 *   - Separate from settingsStore so the value is never persisted — it is
 *     an observation of the OS, not a user preference.
 *   - Seeded from matchMedia at module init so the first paint of a
 *     follow-system window already uses the right theme (no light flash).
 *
 * @coordinates-with hooks/useSystemAppearanceWatcher.ts — keeps prefersDark live
 * @coordinates-with hooks/useEffectiveTheme.ts — resolves the effective theme id
 * @module stores/systemAppearanceStore
 */

import { create } from "zustand";

/** Read the OS dark-mode preference. False when matchMedia is unavailable
 *  (jsdom, SSR) or throws — light is the safe default. */
export function readSystemPrefersDark(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

interface SystemAppearanceState {
  /** True when the OS currently prefers a dark color scheme. */
  prefersDark: boolean;
  setPrefersDark: (prefersDark: boolean) => void;
}

/** Runtime OS appearance state. Use selectors, not destructuring. */
export const useSystemAppearanceStore = create<SystemAppearanceState>()((set) => ({
  prefersDark: readSystemPrefersDark(),
  setPrefersDark: (prefersDark) => set({ prefersDark }),
}));
