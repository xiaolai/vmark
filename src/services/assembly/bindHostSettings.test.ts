/**
 * The app's binding of the plugin host-settings seam.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts
 * @module services/assembly/bindHostSettings.test
 */
import { describe, it, expect, afterEach } from "vitest";
import { bindPluginHostSettings } from "./bindHostSettings";
import { hostSettings, resetHostSettings } from "@/plugins/shared/hostSettings";
import { useSettingsStore } from "@/stores/settingsStore";

afterEach(resetHostSettings);

describe("bindPluginHostSettings", () => {
  it("makes the seam read the user's real tab size", () => {
    useSettingsStore.getState().updateGeneralSetting("tabSize", 8);
    bindPluginHostSettings();
    expect(hostSettings.tabSize()).toBe(8);
    useSettingsStore.getState().updateGeneralSetting("tabSize", 2);
  });

  it("reads LIVE, so changing the setting afterwards is picked up", () => {
    // Bound once at startup; the getter is what re-reads. Capturing the value
    // at bind time would freeze whatever the user had when the app launched.
    bindPluginHostSettings();
    useSettingsStore.getState().updateGeneralSetting("tabSize", 6);
    expect(hostSettings.tabSize()).toBe(6);
    useSettingsStore.getState().updateGeneralSetting("tabSize", 2);
  });
});
