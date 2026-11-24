/**
 * Startup menu sync.
 *
 * Purpose: Rust builds the launch menu with English labels and DEFAULT
 * accelerators, because it cannot read the frontend's persisted settings.
 * This rebuilds that menu when the launch window starts, if the menu differs
 * from what the user saved: a non-English language (set the Rust locale
 * first, for the labels), or a custom binding for a menu-backed shortcut
 * (#1720 — without this an English user's
 * rebound menu item reverted to its default after a restart).
 * Must run after both i18n and shortcutsStore are initialized (both hydrate
 * synchronously from localStorage at import).
 *
 * Key decisions:
 *   - One path for both reasons: `rebuildNativeMenu` carries the effective
 *     shortcut map, so the locale and the bindings land in a single rebuild
 *     with nothing to race. It also reaches the conditional items that are
 *     stashed outside the live menu while their feature is off, which the
 *     `update_menu_accelerators` diff skips.
 *   - No locale change and no menu-backed custom binding: the default menu
 *     is already right, so nothing is sent.
 *   - Launch window only. The native menu is app-global and every window
 *     imports this module; the other windows would repeat the same rebuild.
 *     A `main` window recreated later in the same process runs it again,
 *     from the then-current persisted state, which is harmless.
 *   - Every failure, synchronous or not, goes to `menuSyncWarn`: this runs
 *     at import, before bootstrap, so a throw here (a malformed persisted
 *     binding map, or no Tauri window in a plain-browser `pnpm dev` page)
 *     would stop the app.
 *
 * Separated from i18n.ts to avoid a circular dependency:
 *   i18n.ts → shortcutsStore.ts → i18n.ts
 *
 * @coordinates-with i18n.ts — relies on Rust locale being set first
 * @coordinates-with rebuildNativeMenu.ts — shared rebuild pipeline
 *
 * @module services/menu/startupMenuSync
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { menuSyncWarn } from "@/utils/debug";
import { isLaunchWindow } from "@/utils/windowLabels";
import { DEFAULT_SHORTCUTS, useSettingsStore, useShortcutsStore } from "@/stores/settingsStore";
import { rebuildNativeMenu } from "@/services/menu/rebuildNativeMenu";

async function syncStartupMenu(): Promise<void> {
  if (!isLaunchWindow(getCurrentWebviewWindow().label)) return;

  const startupLang = useSettingsStore.getState().general.language;
  if (startupLang && startupLang !== "en") {
    // The locale goes first and does not depend on the shortcut map: a
    // malformed binding map must not also cost the user their language.
    await invoke("set_locale", { locale: startupLang });
    await rebuildNativeMenu();
    return;
  }

  // Only a binding that backs a menu item changes the native menu.
  const bindings = useShortcutsStore.getState().customBindings;
  const customizesMenu = DEFAULT_SHORTCUTS.some(
    (def) => def.menuId !== undefined && Object.hasOwn(bindings, def.id),
  );
  if (customizesMenu) await rebuildNativeMenu();
}

syncStartupMenu().catch((e: unknown) => { menuSyncWarn("rebuild failed:", e); });
