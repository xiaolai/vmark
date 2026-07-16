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
 * @coordinates-with stores/windowStatusStore.ts — consumed via persist()
 * @coordinates-with services/persistence/workspaceStorage.ts — shares the
 *   current-window-label source of truth (getCurrentWindowLabel)
 * @module services/persistence/windowStatusStorage
 */
import type { StateStorage } from "zustand/middleware";

import { getCurrentWindowLabel } from "./workspaceStorage";

const KEY_PREFIX = "vmark-window-status";

/** Storage key for a window's panel preferences: `vmark-window-status:{label}`. */
export function getWindowStatusStorageKey(label: string): string {
  return `${KEY_PREFIX}:${label}`;
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
