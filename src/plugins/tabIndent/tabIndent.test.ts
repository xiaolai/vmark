// @vitest-environment node
/**
 * Tab Indent Tests
 *
 * Tests for the tabSize setting used by tab indent handlers.
 * The handlers themselves are integration code that requires editor setup.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";

describe("Tab Indent Settings", () => {
  beforeEach(() => {
    // Reset settings to defaults before each test
    useSettingsStore.getState().resetSettings();
  });

  describe("tabSize setting", () => {
    it("should have a default value of 2", () => {
      const tabSize = useSettingsStore.getState().general.tabSize;
      expect(tabSize).toBe(2);
    });

    it("should be updatable via updateGeneralSetting", () => {
      useSettingsStore.getState().updateGeneralSetting("tabSize", 4);
      const tabSize = useSettingsStore.getState().general.tabSize;
      expect(tabSize).toBe(4);
    });

    it("should persist after multiple updates", () => {
      useSettingsStore.getState().updateGeneralSetting("tabSize", 4);
      useSettingsStore.getState().updateGeneralSetting("tabSize", 8);
      const tabSize = useSettingsStore.getState().general.tabSize;
      expect(tabSize).toBe(8);
    });

    it("should reset to default when resetSettings is called", () => {
      useSettingsStore.getState().updateGeneralSetting("tabSize", 4);
      useSettingsStore.getState().resetSettings();
      const tabSize = useSettingsStore.getState().general.tabSize;
      expect(tabSize).toBe(2);
    });
  });
});
