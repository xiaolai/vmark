/**
 * Shortcuts Sync Hook
 *
 * Purpose: Propagates keyboard-shortcut rebinds between windows, the same way
 * useSettingsSync does for settings.
 *
 * Why this exists: shortcuts are edited in the Settings window (a separate
 * Tauri webview with its own store instance), but they are CONSUMED in document
 * windows — the Tiptap keymap, the CodeMirror keymap, and ~15 non-menu handlers
 * all read useShortcutsStore and rebuild on its subscription. Without a
 * cross-window path those subscriptions never fire in the document window.
 *
 * The native menu path was already correct and hid the bug: setShortcut invokes
 * `update_menu_accelerators`, and the macOS menu bar is app-global, so
 * menu-backed shortcuts appeared to work. What actually happened is that the
 * document window kept its OLD frontend binding while the menu gained the NEW
 * one — both live at once — and shortcuts with no menuId (command palette,
 * quick open, genies) did not change at all until restart.
 *
 * Key decisions:
 *   - Applies via setState rather than the store's actions on purpose: the
 *     actions re-invoke the native menu sync, which the originating window has
 *     already done. Going through them would bounce accelerator updates between
 *     windows for no benefit.
 *   - Validates values are strings before adopting them (zero-trust at the
 *     storage boundary, matching useSettingsSync).
 *
 * @coordinates-with stores/settingsStore/shortcuts.ts — the synced store
 * @coordinates-with hooks/useSettingsSync.ts — sibling for the settings store
 * @module hooks/useShortcutsSync
 */

import { useEffect } from "react";
import { useShortcutsStore } from "@/stores/settingsStore/shortcuts";
import { shortcutsSyncWarn } from "@/utils/debug";

const STORAGE_KEY = "vmark-shortcuts";

/**
 * Process a storage event and adopt another window's shortcut bindings.
 * Exported for testing.
 */
export function handleShortcutsStorageEvent(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY || !event.newValue) return;

  let parsed: { state?: { customBindings?: unknown } };
  try {
    parsed = JSON.parse(event.newValue);
  } catch {
    return; // malformed JSON — a corrupt write must not clear live bindings
  }

  // Application errors below are not parse errors — surface them instead of
  // masking them as malformed JSON (audit Medium-11).
  try {
    const incoming = parsed?.state?.customBindings;
    if (
      incoming == null ||
      typeof incoming !== "object" ||
      Array.isArray(incoming)
    ) {
      return; // malformed write — leave live bindings alone
    }

    // Bindings are id -> key strings. Drop anything else rather than letting a
    // non-string reach the keymap builders.
    const clean: Record<string, string> = {};
    for (const [id, key] of Object.entries(incoming as Record<string, unknown>)) {
      if (typeof key === "string") clean[id] = key;
    }

    const current = useShortcutsStore.getState().customBindings;
    if (JSON.stringify(current) === JSON.stringify(clean)) return;

    useShortcutsStore.setState({ customBindings: clean });
  } catch (error) {
    shortcutsSyncWarn("failed to apply cross-window shortcuts", error);
  }
}

/** Adopts shortcut rebinds made in other windows. */
export function useShortcutsSync() {
  useEffect(() => {
    window.addEventListener("storage", handleShortcutsStorageEvent);
    return () =>
      window.removeEventListener("storage", handleShortcutsStorageEvent);
  }, []);
}
