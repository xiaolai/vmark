// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";

describe("language picker setting", () => {
  beforeEach(() => {
    useSettingsStore.getState().updateGeneralSetting("language", "en");
  });

  it("defaults to English", () => {
    expect(useSettingsStore.getState().general.language).toBe("en");
  });

  it("can be changed via updateGeneralSetting", () => {
    useSettingsStore.getState().updateGeneralSetting("language", "zh-CN");
    expect(useSettingsStore.getState().general.language).toBe("zh-CN");
  });

  it("persists after multiple changes", () => {
    useSettingsStore.getState().updateGeneralSetting("language", "ja");
    useSettingsStore.getState().updateGeneralSetting("language", "fr");
    expect(useSettingsStore.getState().general.language).toBe("fr");
  });
});
