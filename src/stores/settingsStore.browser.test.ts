// @vitest-environment node
// WI-1.10 — embedded-browser feature gate (settings.browser.enabled).
//
// Default flipped to ON on 2026-08-15 (maintainer decision), resolving the
// 2026-11-01 exit criterion in .claude/rules/60-ai-governance.md §12 early.
// The posture defaults below did NOT change and are the reason that is
// defensible: the AI path still opens sandboxed with loopback refused.
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { normalizeBrowserSettings } from "./settingsStore/persistGuards";

beforeEach(() => {
  useSettingsStore.getState().resetSettings();
});

describe("settings.browser", () => {
  it("defaults the embedded browser to enabled", () => {
    expect(useSettingsStore.getState().browser.enabled).toBe(true);
  });

  it("toggles enabled via updateBrowserSetting", () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    expect(useSettingsStore.getState().browser.enabled).toBe(false);
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    expect(useSettingsStore.getState().browser.enabled).toBe(true);
  });

  it("resetSettings restores the default-on state", () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().browser.enabled).toBe(true);
  });

  /// The off switch has to be reachable, which for a default-on feature means
  /// the pane that hosts it is visible without an undocumented chord.
  it("ships the Advanced pane visible, so the off switch can be found", () => {
    expect(useSettingsStore.getState().showDevSection).toBe(true);
  });

  /// Enabling the browser must NOT drag the AI posture open with it. These are
  /// what keep the default-on surface narrow.
  it("keeps the AI posture conservative despite shipping enabled", () => {
    expect(useSettingsStore.getState().browser.aiSession).toBe("sandbox");
    expect(useSettingsStore.getState().browser.aiAllowLoopback).toBe(false);
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
