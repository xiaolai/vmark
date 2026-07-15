import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../settingsStore";

describe("settingsStore — tableFitToWidth", () => {
  beforeEach(() => {
    // Reset to initial state
    useSettingsStore.getState().resetSettings();
  });

  it("defaults to false", () => {
    const { markdown } = useSettingsStore.getState();
    expect(markdown.tableFitToWidth).toBe(false);
  });

  it("can be toggled to true via updateMarkdownSetting", () => {
    useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", true);
    expect(useSettingsStore.getState().markdown.tableFitToWidth).toBe(true);
  });

  it("can be toggled back to false", () => {
    useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", true);
    useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", false);
    expect(useSettingsStore.getState().markdown.tableFitToWidth).toBe(false);
  });
});

describe("settingsStore — lintEnabled", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it("defaults to true", () => {
    const { markdown } = useSettingsStore.getState();
    expect(markdown.lintEnabled).toBe(true);
  });

  it("can be toggled to false via updateMarkdownSetting", () => {
    useSettingsStore.getState().updateMarkdownSetting("lintEnabled", false);
    expect(useSettingsStore.getState().markdown.lintEnabled).toBe(false);
  });

  it("can be toggled back to true", () => {
    useSettingsStore.getState().updateMarkdownSetting("lintEnabled", false);
    useSettingsStore.getState().updateMarkdownSetting("lintEnabled", true);
    expect(useSettingsStore.getState().markdown.lintEnabled).toBe(true);
  });
});

describe("settingsStore — largeFile section", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it("defaults autoSourceMode to true so large files open in Source mode", () => {
    expect(useSettingsStore.getState().largeFile.autoSourceMode).toBe(true);
  });

  it("defaults warnAbove5MB to true so users get a confirmation on huge files", () => {
    expect(useSettingsStore.getState().largeFile.warnAbove5MB).toBe(true);
  });

  it("updateLargeFileSetting toggles autoSourceMode without affecting other keys", () => {
    const before = useSettingsStore.getState().largeFile.warnAbove5MB;
    useSettingsStore.getState().updateLargeFileSetting("autoSourceMode", false);
    expect(useSettingsStore.getState().largeFile.autoSourceMode).toBe(false);
    expect(useSettingsStore.getState().largeFile.warnAbove5MB).toBe(before);
  });

  it("resetSettings restores large-file defaults", () => {
    useSettingsStore.getState().updateLargeFileSetting("autoSourceMode", false);
    useSettingsStore.getState().updateLargeFileSetting("warnAbove5MB", false);
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().largeFile).toEqual({
      autoSourceMode: true,
      warnAbove5MB: true,
    });
  });
});

describe("settingsStore — terminal.screenReaderMode (G3/WI-3.1)", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it("defaults to false (off for performance)", () => {
    expect(useSettingsStore.getState().terminal.screenReaderMode).toBe(false);
  });

  it("updateTerminalSetting toggles screenReaderMode without affecting other keys", () => {
    const beforeShell = useSettingsStore.getState().terminal.shell;
    useSettingsStore.getState().updateTerminalSetting("screenReaderMode", true);
    expect(useSettingsStore.getState().terminal.screenReaderMode).toBe(true);
    expect(useSettingsStore.getState().terminal.shell).toBe(beforeShell);
  });
});

describe("settingsStore — terminal.scrollback (G7/WI-4.2)", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it("defaults to 5000", () => {
    expect(useSettingsStore.getState().terminal.scrollback).toBe(5000);
  });

  it("updateTerminalSetting changes scrollback to a preset value", () => {
    useSettingsStore.getState().updateTerminalSetting("scrollback", 10000);
    expect(useSettingsStore.getState().terminal.scrollback).toBe(10000);
  });
});

describe("settingsStore — advanced.developerMode", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  // Persisted (not ephemeral component state) so that once a developer turns on
  // developer mode, the experimental toggles — including the embedded browser —
  // stay reachable across sessions, in release builds too.
  it("defaults to false", () => {
    expect(useSettingsStore.getState().advanced.developerMode).toBe(false);
  });

  it("can be toggled via updateAdvancedSetting and persists in the store", () => {
    useSettingsStore.getState().updateAdvancedSetting("developerMode", true);
    expect(useSettingsStore.getState().advanced.developerMode).toBe(true);
    useSettingsStore.getState().updateAdvancedSetting("developerMode", false);
    expect(useSettingsStore.getState().advanced.developerMode).toBe(false);
  });
});
