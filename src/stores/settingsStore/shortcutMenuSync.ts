/**
 * Shortcut → native menu sync — pushes the effective shortcut map to
 * `update_menu_accelerators` and reports a refusal to whoever is listening.
 *
 * Key decisions:
 *   - Trailing debounce: rapid edits (Reset All, Import) become one native
 *     menu update, and updates are serialized so an older map never lands
 *     after a newer one.
 *   - A rejection is not only logged. The store cannot translate (it sits
 *     below `i18n`), so it hands the raw error to `onMenuShortcutSyncFailure`
 *     listeners; the Shortcuts pane toasts it, so a rebinding the menu refused
 *     does not look applied.
 *
 * @coordinates-with stores/settingsStore/shortcuts.ts — calls `syncMenuShortcuts` after every change
 * @coordinates-with pages/settings/ShortcutsSettings.tsx — the failure listener
 * @module stores/settingsStore/shortcutMenuSync
 */

import { invoke } from "@tauri-apps/api/core";
import { shortcutsWarn } from "@/utils/debug";
import { DEFAULT_SHORTCUTS } from "./shortcutDefinitions";
import { prosemirrorToTauri } from "./keyFormatting";

/** Trailing-debounce window for shortcut edits. Batches rapid changes
 *  (e.g. Reset All, Import) into one native menu update. */
const SYNC_DEBOUNCE_MS = 100;

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingShortcuts: Record<string, string> | null = null;
let inFlightSync: Promise<void> = Promise.resolve();

type SyncFailureListener = (error: unknown) => void;
const failureListeners = new Set<SyncFailureListener>();

/**
 * Be told when the native menu rejects a shortcut update. Returns the
 * unsubscribe function.
 */
export function onMenuShortcutSyncFailure(listener: SyncFailureListener): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

/** Schedule a native menu update with the full effective shortcut map. */
export function syncMenuShortcuts(shortcuts: Record<string, string>): void {
  pendingShortcuts = shortcuts;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const next = pendingShortcuts;
    pendingShortcuts = null;
    if (next) queueSyncMenuShortcuts(next);
  }, SYNC_DEBOUNCE_MS);
}

/** Flush any pending debounced sync immediately. Exported for tests. */
export function flushMenuShortcutsSync(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
    const next = pendingShortcuts;
    pendingShortcuts = null;
    if (next) queueSyncMenuShortcuts(next);
  }
  return inFlightSync;
}

function queueSyncMenuShortcuts(shortcuts: Record<string, string>): void {
  inFlightSync = inFlightSync
    .catch(() => {})
    .then(() => syncMenuShortcutsNow(shortcuts));
}

async function syncMenuShortcutsNow(shortcuts: Record<string, string>): Promise<void> {
  const menuShortcuts: Record<string, string> = {};
  for (const def of DEFAULT_SHORTCUTS) {
    const key = shortcuts[def.id];
    if (def.menuId && key !== undefined) {
      menuShortcuts[def.menuId] = prosemirrorToTauri(key);
    }
  }
  try {
    await invoke("update_menu_accelerators", { shortcuts: menuShortcuts });
  } catch (e) {
    shortcutsWarn("Failed to sync menu shortcuts:", e);
    for (const listener of failureListeners) listener(e);
  }
}
