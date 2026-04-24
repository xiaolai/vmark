/**
 * Rebuild Native Menu
 *
 * Purpose: Triggers a full native menu rebuild — translates current shortcuts
 * to Tauri accelerators, invokes rebuild_menu, re-populates the Genies
 * submenu, and re-syncs recent files / workspaces (both are reset to empty
 * placeholders by rebuild_menu).
 *
 * Called on startup (after locale change) and when runtime state that
 * affects menu content changes (e.g., user installs Pandoc and clicks
 * "Detect" in Settings → Files & Images → Document Tools).
 *
 * @coordinates-with stores/shortcutsStore.ts — DEFAULT_SHORTCUTS + prosemirrorToTauri
 * @coordinates-with stores/recentFilesStore.ts — syncToNativeMenu
 * @coordinates-with stores/recentWorkspacesStore.ts — syncToNativeMenu
 * @coordinates-with src-tauri/src/menu/commands.rs — rebuild_menu, refresh_genies_menu
 * @module utils/rebuildNativeMenu
 */

import { invoke } from "@tauri-apps/api/core";
import {
  useShortcutsStore,
  DEFAULT_SHORTCUTS,
  prosemirrorToTauri,
} from "@/stores/shortcutsStore";

/**
 * Build the {menuId → Tauri accelerator} map from the current shortcuts store.
 */
function buildMenuShortcuts(): Record<string, string> {
  const allShortcuts = useShortcutsStore.getState().getAllShortcuts();
  const menuShortcuts: Record<string, string> = {};
  for (const def of DEFAULT_SHORTCUTS) {
    if (def.menuId) {
      menuShortcuts[def.menuId] = prosemirrorToTauri(allShortcuts[def.id] ?? "");
    }
  }
  return menuShortcuts;
}

/**
 * Rebuild the native application menu and re-populate its dynamic submenus.
 *
 * Sequence:
 * 1. `rebuild_menu` — Rust rebuilds the whole menu tree with current shortcuts
 * 2. `refresh_genies_menu` — Genies submenu is reset by rebuild_menu; re-populate
 * 3. Recent files + workspaces — also reset; re-sync from frontend stores
 *
 * Any individual step may throw; callers should handle errors.
 */
export async function rebuildNativeMenu(): Promise<void> {
  const menuShortcuts = buildMenuShortcuts();
  await invoke("rebuild_menu", { shortcuts: menuShortcuts });

  const geniesAccel = menuShortcuts["search-genies"]
    ? { "search-genies": menuShortcuts["search-genies"] }
    : null;
  await invoke("refresh_genies_menu", { shortcuts: geniesAccel });

  const { useRecentFilesStore } = await import("@/stores/recentFilesStore");
  const { useRecentWorkspacesStore } = await import("@/stores/recentWorkspacesStore");
  useRecentFilesStore.getState().syncToNativeMenu();
  useRecentWorkspacesStore.getState().syncToNativeMenu();
}
