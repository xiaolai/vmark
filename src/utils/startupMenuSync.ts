/**
 * Startup menu sync.
 *
 * Purpose: Rebuilds the native menu bar with translated labels when the
 * user's saved language is non-English. Must run after both i18n and
 * shortcutsStore are initialized.
 *
 * Separated from i18n.ts to avoid a circular dependency:
 *   i18n.ts → shortcutsStore.ts → i18n.ts
 *
 * @coordinates-with i18n.ts — relies on Rust locale being set first
 * @coordinates-with utils/rebuildNativeMenu.ts — shared rebuild pipeline
 */
import { invoke } from "@tauri-apps/api/core";
import { menuSyncWarn } from "@/utils/debug";
import { useSettingsStore } from "@/stores/settingsStore";
import { rebuildNativeMenu } from "@/utils/rebuildNativeMenu";

const startupLang = useSettingsStore.getState().general.language;
if (startupLang && startupLang !== "en") {
  invoke("set_locale", { locale: startupLang })
    .then(rebuildNativeMenu)
    .catch((e) => { menuSyncWarn("rebuild failed:", e); });
}
