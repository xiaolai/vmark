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
