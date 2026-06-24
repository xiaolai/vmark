import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { isWorkspaceRailEnabled } from "./workspaceRailFeatureFlag";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  useSettingsStore.getState().resetSettings();
});

describe("workspace rail feature flag", () => {
  it("is disabled by default", () => {
    expect(useSettingsStore.getState().advanced.workspaceRailMode).toBe(false);
    expect(isWorkspaceRailEnabled()).toBe(false);
  });

  it("reads the persisted advanced setting", () => {
    useSettingsStore.getState().updateAdvancedSetting("workspaceRailMode", true);
    expect(isWorkspaceRailEnabled()).toBe(true);
  });

  it("resets to disabled", () => {
    useSettingsStore.getState().updateAdvancedSetting("workspaceRailMode", true);
    useSettingsStore.getState().resetSettings();
    expect(isWorkspaceRailEnabled()).toBe(false);
  });
});
