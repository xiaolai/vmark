// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../settingsStore";

describe("settings language field", () => {
  beforeEach(() => {
    useSettingsStore.getState().updateGeneralSetting("language", "en");
  });

  it("defaults to English", () => {
    const { general } = useSettingsStore.getState();
    expect(general.language).toBe("en");
  });

  it("can be changed to another language", () => {
    useSettingsStore.getState().updateGeneralSetting("language", "zh-CN");
    expect(useSettingsStore.getState().general.language).toBe("zh-CN");
  });
});
