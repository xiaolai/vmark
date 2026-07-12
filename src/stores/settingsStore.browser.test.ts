// WI-1.10 — embedded-browser feature gate (settings.browser.enabled, default off)
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";

beforeEach(() => {
  useSettingsStore.getState().resetSettings();
});

describe("settings.browser", () => {
  it("defaults the embedded browser to disabled (default-off feature flag)", () => {
    expect(useSettingsStore.getState().browser.enabled).toBe(false);
  });

  it("toggles enabled via updateBrowserSetting", () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    expect(useSettingsStore.getState().browser.enabled).toBe(true);
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    expect(useSettingsStore.getState().browser.enabled).toBe(false);
  });

  it("resetSettings restores the default-off state", () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().browser.enabled).toBe(false);
  });
});
