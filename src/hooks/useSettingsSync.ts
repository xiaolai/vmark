/**
 * Settings Sync Hook
 *
 * Purpose: Synchronizes user settings across multiple windows using
 *   localStorage storage events — when one window changes settings,
 *   others pick up the change via the browser's storage event.
 *
 * Key decisions:
 *   - Uses localStorage (not Tauri events) because settingsStore already
 *     persists to localStorage via Zustand persist middleware. Verified: the
 *     `storage` event does cross Tauri v2 webviews (all windows share one
 *     custom-protocol origin), so this is a real transport, not an assumption.
 *   - Syncs every persisted section, derived from the store's own defaults
 *     rather than a hand-maintained allow-list (see SYNC_GROUPS).
 *   - processStorageEvent exported for testing
 *
 * @coordinates-with settingsStore.ts — reads/writes persisted settings
 * @module hooks/useSettingsSync
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { initialState } from "@/stores/settingsStore/defaults";
import type { ObjectSections } from "@/stores/settingsStore/defaults";
import { reconcileSettings } from "@/stores/settingsStore/reconcile";
import { settingsSyncWarn } from "@/utils/debug";

const STORAGE_KEY = "vmark-settings";

type SyncGroup = ObjectSections;

/**
 * Every object-valued settings section, derived from the store's own defaults.
 *
 * This list must never be hand-maintained. It previously was, and silently
 * omitted `terminal`, `largeFile` and `browser` — which is not merely a
 * staleness bug: because the store's `persist` has no `partialize`, every
 * window serializes its WHOLE state on any write, so a window that skips a
 * group later writes its stale copy back over the other window's change. A
 * missing group is silent data loss on a background timer.
 *
 * Deriving from `initialState` mirrors `ObjectSections` (defaults.ts), so a
 * newly added section syncs automatically instead of drifting. `showDevSection`
 * is excluded by construction — it is a boolean UI flag read only inside the
 * Settings window itself.
 */
export const SYNC_GROUPS: readonly SyncGroup[] = Object.keys(initialState).filter(
  (key) => {
    const value = initialState[key as keyof typeof initialState];
    return typeof value === "object" && value !== null;
  },
) as SyncGroup[];

/**
 * Process a storage event and sync settings to the store.
 * Exported for testing.
 */
export function handleSettingsStorageEvent(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY || !event.newValue) {
    return;
  }

  let parsed: { state?: Record<string, unknown> };
  try {
    parsed = JSON.parse(event.newValue);
  } catch {
    return; // malformed JSON from another window — ignore
  }

  // Application errors below (reconcile, setState, synchronous store
  // subscribers) are NOT parse errors and must not be silently swallowed as
  // if they were — that hid real failures behind a "corrupt JSON" catch and
  // could leave partially applied state (audit Medium-11).
  try {
    if (!parsed.state) return;

    const currentState = useSettingsStore.getState();
    const incoming: Record<string, unknown> = {};

    // Collect the groups that actually differ. Validate each group's SHAPE
    // first (WI-4.2, T3): a malformed cross-window write must not inject a
    // string/array/primitive where a settings group object is expected.
    // Settings groups are always plain objects.
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
        incoming[group] = newValue;
      }
    }

    if (Object.keys(incoming).length === 0) return;

    // Route through the SAME trust boundary hydration uses (C4). A raw
    // setState here bypassed sanitize/clamp/normalize — so a corrupt value
    // rejected at startup was accepted live from another window — and replaced
    // each group wholesale, dropping keys the writer happened to omit instead
    // of defaulting them.
    const reconciled = reconcileSettings(
      currentState as unknown as Record<string, unknown>,
      incoming,
    );
    const updates: Record<string, unknown> = {};
    for (const group of Object.keys(incoming)) {
      updates[group] = reconciled[group];
    }
    useSettingsStore.setState(updates);
  } catch (error) {
    // A real failure applying a well-formed event — surface it rather than
    // pretend the write was malformed.
    settingsSyncWarn("failed to apply cross-window settings", error);
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
