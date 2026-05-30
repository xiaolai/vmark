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
  // `formats` must sync cross-window so that toggling a category in the
  // Settings window (a separate Tauri webview) re-bootstraps the format
  // registry in the document window via useFormatSettingsBridge. Without
  // this, the toggle only takes effect after restart and `.mmd`/`.svg`/
  // `.html`/code-viewer adapters keep falling through to plain text.
  "formats",
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

    // Sync all setting groups. Validate each group's SHAPE before merging
    // (WI-4.2, T3): a malformed cross-tab localStorage write must not inject a
    // string/array/primitive where a settings group object is expected and
    // corrupt live settings. Settings groups are always plain objects.
    for (const group of SYNC_GROUPS) {
      const newValue = parsed.state[group];
      if (
        newValue == null ||
        typeof newValue !== "object" ||
        Array.isArray(newValue)
      ) {
        continue; // skip non-object groups — don't corrupt the live store
      }
      const currentValue = currentState[group as SyncGroup];
      if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
        updates[group] = newValue;
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
