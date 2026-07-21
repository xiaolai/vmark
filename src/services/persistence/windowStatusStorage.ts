/**
 * Window-scoped persistence for the Window-Status panel (#1120).
 *
 * Purpose: A `StateStorage` adapter that keys the panel's open/pin
 * preferences per window, so each window remembers its own panel state
 * across restarts (survives for stable labels like "main", the same way
 * workspace state does).
 *
 * Uses its OWN key namespace (`vmark-window-status:{label}`) — reusing
 * `windowScopedStorage` from workspaceStorage.ts would collide on the
 * `vmark-workspace:{label}` key and corrupt both stores. The payload is two
 * booleans, so no quota-warning machinery is needed (unlike the workspace
 * adapter).
 *
 * Also exposes the app-global "pin all windows" flag (#1135) via
 * `getGlobalPinPref` / `setGlobalPinPref`. That one is deliberately NOT
 * label-scoped — it lives under a reserved key so every window reads the same
 * value (localStorage is per-origin), which is what lets a newly opened window
 * honor the global pin before it renders.
 *
 * @coordinates-with stores/windowStatusStore.ts — consumed via persist()
 * @coordinates-with services/persistence/workspaceStorage.ts — shares the
 *   current-window-label source of truth (getCurrentWindowLabel)
 * @module services/persistence/windowStatusStorage
 */
import type { StateStorage } from "zustand/middleware";

import { getCurrentWindowLabel } from "./workspaceStorage";

const KEY_PREFIX = "vmark-window-status";

/**
 * App-global key for the "pin all windows" flag (#1135). Unlike the per-window
 * prefs, this is shared across every window (localStorage is per-origin, so all
 * windows read the same value), so it is NOT label-scoped. The `__` prefix
 * keeps it clear of any real window label passed to `getWindowStatusStorageKey`.
 */
const GLOBAL_PIN_KEY = `${KEY_PREFIX}:__global-pin`;

/** Storage key for a window's panel preferences: `vmark-window-status:{label}`. */
export function getWindowStatusStorageKey(label: string): string {
  return `${KEY_PREFIX}:${label}`;
}

/** Read the persisted app-global "pin all windows" flag (#1135). */
export function getGlobalPinPref(): boolean {
  return localStorage.getItem(GLOBAL_PIN_KEY) === "1";
}

/**
 * Persist the app-global "pin all windows" flag (#1135). Best-effort — a
 * full/blocked localStorage just means the flag won't survive this session,
 * which must never crash the app.
 */
export function setGlobalPinPref(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(GLOBAL_PIN_KEY, "1");
    else localStorage.removeItem(GLOBAL_PIN_KEY);
  } catch {
    // Panel prefs are non-critical.
  }
}

export const windowStatusScopedStorage: StateStorage = {
  getItem: (_name: string): string | null =>
    localStorage.getItem(getWindowStatusStorageKey(getCurrentWindowLabel())),
  setItem: (_name: string, value: string): void => {
    try {
      localStorage.setItem(getWindowStatusStorageKey(getCurrentWindowLabel()), value);
    } catch {
      // Panel prefs are non-critical: a full/blocked localStorage just means
      // the pin/open state won't persist this session — never crash the app.
    }
  },
  removeItem: (_name: string): void =>
    localStorage.removeItem(getWindowStatusStorageKey(getCurrentWindowLabel())),
};
