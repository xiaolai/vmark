import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";

beforeEach(() => {
  useSettingsStore.getState().resetSettings();
});

describe("settingsStore MCP server settings", () => {
  it("sets default MCP server settings", () => {
    const state = useSettingsStore.getState();
    expect(state.advanced.mcpServer.port).toBe(9223);
    expect(state.advanced.mcpServer.autoStart).toBe(true);
    expect(state.advanced.mcpServer.autoApproveEdits).toBe(false);
  });

  it("updates autoApproveEdits setting", () => {
    const state = useSettingsStore.getState();
    const currentSettings = state.advanced.mcpServer;

    state.updateAdvancedSetting("mcpServer", {
      ...currentSettings,
      autoApproveEdits: true,
    });

    expect(useSettingsStore.getState().advanced.mcpServer.autoApproveEdits).toBe(true);
  });

  it("preserves other MCP settings when updating autoApproveEdits", () => {
    const state = useSettingsStore.getState();
    const currentSettings = state.advanced.mcpServer;

    state.updateAdvancedSetting("mcpServer", {
      ...currentSettings,
      autoApproveEdits: true,
    });

    const updatedSettings = useSettingsStore.getState().advanced.mcpServer;
    expect(updatedSettings.port).toBe(9223);
    expect(updatedSettings.autoStart).toBe(true);
    expect(updatedSettings.autoApproveEdits).toBe(true);
  });

  it("resets autoApproveEdits to false on resetSettings", () => {
    const state = useSettingsStore.getState();
    const currentSettings = state.advanced.mcpServer;

    // Enable autoApproveEdits
    state.updateAdvancedSetting("mcpServer", {
      ...currentSettings,
      autoApproveEdits: true,
    });
    expect(useSettingsStore.getState().advanced.mcpServer.autoApproveEdits).toBe(true);

    // Reset should restore default (false)
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().advanced.mcpServer.autoApproveEdits).toBe(false);
  });
});

describe("settingsStore confirmQuit", () => {
  it("defaults confirmQuit to true", () => {
    expect(useSettingsStore.getState().general.confirmQuit).toBe(true);
  });

  it("toggles confirmQuit off and on", () => {
    useSettingsStore.getState().updateGeneralSetting("confirmQuit", false);
    expect(useSettingsStore.getState().general.confirmQuit).toBe(false);

    useSettingsStore.getState().updateGeneralSetting("confirmQuit", true);
    expect(useSettingsStore.getState().general.confirmQuit).toBe(true);
  });

  it("resets confirmQuit to true on resetSettings", () => {
    useSettingsStore.getState().updateGeneralSetting("confirmQuit", false);
    expect(useSettingsStore.getState().general.confirmQuit).toBe(false);

    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().general.confirmQuit).toBe(true);
  });
});

describe("settingsStore history settings", () => {
  it("defaults historyMergeWindow to 30", () => {
    expect(useSettingsStore.getState().general.historyMergeWindow).toBe(30);
  });

  it("defaults historyMaxFileSize to 512", () => {
    expect(useSettingsStore.getState().general.historyMaxFileSize).toBe(512);
  });

  it("updates historyMergeWindow", () => {
    useSettingsStore.getState().updateGeneralSetting("historyMergeWindow", 0);
    expect(useSettingsStore.getState().general.historyMergeWindow).toBe(0);
  });

  it("updates historyMaxFileSize", () => {
    useSettingsStore.getState().updateGeneralSetting("historyMaxFileSize", 1024);
    expect(useSettingsStore.getState().general.historyMaxFileSize).toBe(1024);
  });

  it("resets history settings on resetSettings", () => {
    useSettingsStore.getState().updateGeneralSetting("historyMergeWindow", 120);
    useSettingsStore.getState().updateGeneralSetting("historyMaxFileSize", 0);

    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().general.historyMergeWindow).toBe(30);
    expect(useSettingsStore.getState().general.historyMaxFileSize).toBe(512);
  });
});

describe("settingsStore line break defaults", () => {
  it("sets default line ending and hard break style preferences", () => {
    const state = useSettingsStore.getState();
    expect(state.general.lineEndingsOnSave).toBe("preserve");
    expect(state.markdown.hardBreakStyleOnSave).toBe("preserve");
    expect(state.markdown.pasteMarkdownInWysiwyg).toBe("auto");
  });

  it("updates line ending preference", () => {
    const state = useSettingsStore.getState();
    state.updateGeneralSetting("lineEndingsOnSave", "crlf");
    expect(useSettingsStore.getState().general.lineEndingsOnSave).toBe("crlf");
  });

  it("updates hard break style preference", () => {
    const state = useSettingsStore.getState();
    state.updateMarkdownSetting("hardBreakStyleOnSave", "twoSpaces");
    expect(useSettingsStore.getState().markdown.hardBreakStyleOnSave).toBe("twoSpaces");
  });

  it("updates markdown paste preference", () => {
    const state = useSettingsStore.getState();
    state.updateMarkdownSetting("pasteMarkdownInWysiwyg", "off");
    expect(useSettingsStore.getState().markdown.pasteMarkdownInWysiwyg).toBe("off");
  });
});
