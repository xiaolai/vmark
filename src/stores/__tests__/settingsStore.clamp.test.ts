import { describe, it, expect, beforeEach } from "vitest";
import {
  useSettingsStore,
  clampMergedSettings,
  CLAMP_RANGES,
} from "../settingsStore";

describe("section updater clamping (D4)", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it("clamps an absurdly large fontSize down to the max", () => {
    useSettingsStore.getState().updateAppearanceSetting("fontSize", 999);
    expect(useSettingsStore.getState().appearance.fontSize).toBe(48);
  });

  it("clamps a too-small fontSize up to the min", () => {
    useSettingsStore.getState().updateAppearanceSetting("fontSize", 1);
    expect(useSettingsStore.getState().appearance.fontSize).toBe(8);
  });

  it("leaves an in-range value untouched", () => {
    useSettingsStore.getState().updateAppearanceSetting("fontSize", 20);
    expect(useSettingsStore.getState().appearance.fontSize).toBe(20);
  });

  it("clamps terminal panelRatio into its drag bounds", () => {
    useSettingsStore.getState().updateTerminalSetting("panelRatio", 5);
    expect(useSettingsStore.getState().terminal.panelRatio).toBe(0.8);
  });

  it("does not touch unbounded / non-numeric fields", () => {
    useSettingsStore.getState().updateGeneralSetting("language", "zh-CN");
    expect(useSettingsStore.getState().general.language).toBe("zh-CN");
  });
});

describe("clampMergedSettings (persist boundary, D4)", () => {
  it("clamps corrupt persisted numeric values in place", () => {
    const merged = {
      appearance: { fontSize: 999, lineHeight: 0.1, editorWidth: 50 },
      terminal: { scrollback: 99_999_999 },
      general: { tabSize: 99 },
    };
    clampMergedSettings(merged);
    expect(merged.appearance.fontSize).toBe(48);
    expect(merged.appearance.lineHeight).toBe(1);
    expect(merged.appearance.editorWidth).toBe(50);
    expect(merged.terminal.scrollback).toBe(200_000);
    expect(merged.general.tabSize).toBe(8);
  });

  it("ignores non-object groups and non-numeric values", () => {
    const merged = { appearance: "evil", terminal: { scrollback: "nope" } };
    expect(() => clampMergedSettings(merged as Record<string, unknown>)).not.toThrow();
  });

  it("every clamp range is a valid [min, max] pair", () => {
    for (const ranges of Object.values(CLAMP_RANGES)) {
      for (const [min, max] of Object.values(ranges!)) {
        expect(min).toBeLessThanOrEqual(max);
      }
    }
  });
});
