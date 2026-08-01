/**
 * Purpose: bind the app's settings store to the plugins' host-settings seam.
 *
 * Called once at startup. Plugins depend on `plugins/shared/hostSettings`,
 * which has working defaults and no store import, so they still run when
 * lifted out of this repo — this is the file that makes them read the user's
 * real preferences inside VMark.
 *
 * @coordinates-with plugins/shared/hostSettings.ts — the seam
 * @module services/assembly/bindHostSettings
 */

import { bindHostSettings } from "@/plugins/shared/hostSettings";
import { useSettingsStore } from "@/stores/settingsStore";

/** Point the plugin seam at the live settings store. */
export function bindPluginHostSettings(): void {
  bindHostSettings({
    tabSize: () => useSettingsStore.getState().general.tabSize,
  });
}
