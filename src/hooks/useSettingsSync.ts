/**
 * Settings Sync Hook
 *
 * Purpose: Synchronizes user settings across multiple windows using
 *   localStorage storage events — when one window changes settings,
 *   others pick up the change via the browser's storage event.
 *
 * Key decisions:
 *   - Uses localStorage (not Tauri events) because settingsStore already
 *     persists to localStorage via Zustand persist middleware
 *   - Syncs setting groups independently (appearance, general, markdown, etc.)
 *   - processStorageEvent exported for testing
 *
 * @coordinates-with settingsStore.ts — reads/writes persisted settings
 * @module hooks/useSettingsSync
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

const STORAGE_KEY = "vmark-settings";
const SYNC_GROUPS = [
  "appearance",
  "general",
  "markdown",
  "image",
  "cjkFormatting",
  "advanced",
  "update",
] as const;

type SyncGroup = (typeof SYNC_GROUPS)[number];

/**
 * Process a storage event and sync settings to the store.
 * Exported for testing.
 */
export function handleSettingsStorageEvent(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY || !event.newValue) {
    return;
  }

  try {
    const parsed = JSON.parse(event.newValue);
    if (!parsed.state) return;

    const currentState = useSettingsStore.getState();
    const updates: Record<string, unknown> = {};

    // Sync all setting groups
    for (const group of SYNC_GROUPS) {
      if (parsed.state[group]) {
        const newValue = parsed.state[group];
        const currentValue = currentState[group as SyncGroup];
        if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
          updates[group] = newValue;
        }
      }
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      useSettingsStore.setState(updates);
    }
  } catch {
    // Ignore parse errors
  }
}

/**
 * Syncs settings across windows using storage events.
 * When one window updates localStorage, other windows receive the event.
 */
export function useSettingsSync() {
  useEffect(() => {
    window.addEventListener("storage", handleSettingsStorageEvent);
    return () => window.removeEventListener("storage", handleSettingsStorageEvent);
  }, []);
}
