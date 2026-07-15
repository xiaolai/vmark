// WI-1.10 — embedded-browser feature gate (settings.browser.enabled, default off)
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { normalizeBrowserSettings } from "./settingsStore/persistGuards";

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

  it("defaults AI navigation to sandbox with loopback blocked", () => {
    expect(useSettingsStore.getState().browser.aiSession).toBe("sandbox");
    expect(useSettingsStore.getState().browser.aiAllowLoopback).toBe(false);
  });

  it("persists only the explicit posture choices through typed updates", () => {
    useSettingsStore.getState().updateBrowserSetting("aiSession", "shared");
    useSettingsStore.getState().updateBrowserSetting("aiAllowLoopback", true);
    expect(useSettingsStore.getState().browser).toMatchObject({
      aiSession: "shared",
      aiAllowLoopback: true,
    });
  });

  it("normalizes malformed persisted posture values to sandbox defaults", () => {
    const browser: Record<string, unknown> = {
      aiSession: "human-profile",
      aiAllowLoopback: "yes",
    };
    normalizeBrowserSettings(browser);
    expect(browser).toEqual({ aiSession: "sandbox", aiAllowLoopback: false });
  });
});
