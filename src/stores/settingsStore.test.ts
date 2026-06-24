import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore, sanitizePersistedSettings } from "./settingsStore";

beforeEach(() => {
  useSettingsStore.getState().resetSettings();
});

describe("sanitizePersistedSettings (T4 persist-boundary guard)", () => {
  const defaults = {
    appearance: { fontSize: 18 },
    general: { autoSaveEnabled: true },
  };

  it("keeps well-formed object groups", () => {
    const out = sanitizePersistedSettings(
      { appearance: { fontSize: 22 }, general: { autoSaveEnabled: false } },
      defaults
    );
    expect(out).toEqual({ appearance: { fontSize: 22 }, general: { autoSaveEnabled: false } });
  });

  it("drops a group that is a primitive/array where defaults expect an object", () => {
    const out = sanitizePersistedSettings(
      { appearance: "evil", general: ["nope"] },
      defaults
    );
    // Both mismatched groups dropped — live defaults survive deepMerge.
    expect(out).toEqual({});
  });

  it("drops a null group (cannot recurse) but passes unknown keys through", () => {
    const out = sanitizePersistedSettings(
      { appearance: null, unknownKey: "ok" },
      defaults
    );
    expect(out).toEqual({ unknownKey: "ok" });
  });

  it("drops a primitive leaf whose type mismatches the default", () => {
    const leafDefaults = {
      appearance: { fontSize: 18, theme: "paper", autoHideStatusBar: false },
    };
    const out = sanitizePersistedSettings(
      {
        appearance: {
          fontSize: "999", // string where number expected → dropped
          theme: 7, // number where string expected → dropped
          autoHideStatusBar: "yes", // string where boolean expected → dropped
        },
      },
      leafDefaults,
    );
    expect(out).toEqual({ appearance: {} });
  });

  it("keeps primitive leaves whose type matches the default", () => {
    const leafDefaults = { appearance: { fontSize: 18, theme: "paper" } };
    const out = sanitizePersistedSettings(
      { appearance: { fontSize: 22, theme: "night" } },
      leafDefaults,
    );
    expect(out).toEqual({ appearance: { fontSize: 22, theme: "night" } });
  });

  it("drops a non-array value where the default is an array", () => {
    const arrayDefaults = { advanced: { customLinkProtocols: ["obsidian"] } };
    const out = sanitizePersistedSettings(
      { advanced: { customLinkProtocols: "obsidian" } },
      arrayDefaults,
    );
    expect(out).toEqual({ advanced: {} });
  });

  it("keeps a non-null value where the default is null (nullable field)", () => {
    // lastCheckTimestamp/skipVersion default to null but persist a real value.
    const nullableDefaults = { update: { lastCheckTimestamp: null, skipVersion: null } };
    const out = sanitizePersistedSettings(
      { update: { lastCheckTimestamp: 123, skipVersion: "1.0.0" } },
      nullableDefaults,
    );
    expect(out).toEqual({ update: { lastCheckTimestamp: 123, skipVersion: "1.0.0" } });
  });

  it("drops a non-finite number where a finite number is expected", () => {
    const numericDefaults = { appearance: { fontSize: 18 } };
    const out = sanitizePersistedSettings(
      { appearance: { fontSize: Number.NaN } },
      numericDefaults,
    );
    expect(out).toEqual({ appearance: {} });
  });

  it("recurses into nested branches and drops nested shape mismatches", () => {
    const nestedDefaults = {
      advanced: { mcpServer: { port: 9223 }, customLinkProtocols: [] },
      appearance: { fontSize: 18 },
    };
    const out = sanitizePersistedSettings(
      {
        advanced: {
          mcpServer: "evil", // object expected → dropped
          customLinkProtocols: ["x"], // array default → trusted as-is
          extra: "kept", // unknown key → passes through
        },
        appearance: { fontSize: 22 },
      },
      nestedDefaults
    );
    expect(out).toEqual({
      advanced: { customLinkProtocols: ["x"], extra: "kept" },
      appearance: { fontSize: 22 },
    });
    // The dropped nested object means deepMerge keeps the default mcpServer.
    expect((out.advanced as Record<string, unknown>).mcpServer).toBeUndefined();
  });
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

describe("settingsStore toggleDevSection", () => {
  it("toggles showDevSection", () => {
    const initial = useSettingsStore.getState().showDevSection;
    useSettingsStore.getState().toggleDevSection();
    expect(useSettingsStore.getState().showDevSection).toBe(!initial);
    useSettingsStore.getState().toggleDevSection();
    expect(useSettingsStore.getState().showDevSection).toBe(initial);
  });
});

describe("settingsStore merge migration", () => {
  it("migrates paragraphSpacing to blockSpacing during merge", () => {
    // Simulate old persisted state with paragraphSpacing but no blockSpacing
    const oldPersistedState = {
      appearance: {
        paragraphSpacing: 1.5,
        theme: "day",
      },
    };

    // Access the persist options to test the merge function
    const storeApi = useSettingsStore as unknown as {
      persist: { getOptions: () => { merge?: (persisted: unknown, current: unknown) => unknown } };
    };
    const options = storeApi.persist.getOptions();
    if (options.merge) {
      const currentState = useSettingsStore.getState();
      const result = options.merge(oldPersistedState, currentState) as typeof currentState;
      expect(result.appearance.blockSpacing).toBe(1.5);
    }
  });

  it("migrates legacy advanced workspace rail preference to general settings", () => {
    const storeApi = useSettingsStore as unknown as {
      persist: { getOptions: () => { merge?: (persisted: unknown, current: unknown) => unknown } };
    };
    const options = storeApi.persist.getOptions();
    if (options.merge) {
      const currentState = useSettingsStore.getState();
      const result = options.merge(
        { advanced: { workspaceRailMode: true } },
        currentState,
      ) as typeof currentState;

      expect(result.general.workspaceRailMode).toBe(true);
      expect((result.advanced as Record<string, unknown>).workspaceRailMode).toBeUndefined();
    }
  });

  it("keeps the release-facing workspace rail preference when both paths exist", () => {
    const storeApi = useSettingsStore as unknown as {
      persist: { getOptions: () => { merge?: (persisted: unknown, current: unknown) => unknown } };
    };
    const options = storeApi.persist.getOptions();
    if (options.merge) {
      const currentState = useSettingsStore.getState();
      const result = options.merge(
        {
          general: { workspaceRailMode: false },
          advanced: { workspaceRailMode: true },
        },
        currentState,
      ) as typeof currentState;

      expect(result.general.workspaceRailMode).toBe(false);
      expect((result.advanced as Record<string, unknown>).workspaceRailMode).toBeUndefined();
    }
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

// fix(#946) — opening existing files in a new tab is an opt-in preference.
describe("settingsStore openInNewTab", () => {
  it("defaults openInNewTab to false (legacy reuse-empty-tab behavior)", () => {
    expect(useSettingsStore.getState().general.openInNewTab).toBe(false);
  });

  it("toggles openInNewTab on and off", () => {
    useSettingsStore.getState().updateGeneralSetting("openInNewTab", true);
    expect(useSettingsStore.getState().general.openInNewTab).toBe(true);

    useSettingsStore.getState().updateGeneralSetting("openInNewTab", false);
    expect(useSettingsStore.getState().general.openInNewTab).toBe(false);
  });

  it("resets openInNewTab to false on resetSettings", () => {
    useSettingsStore.getState().updateGeneralSetting("openInNewTab", true);
    expect(useSettingsStore.getState().general.openInNewTab).toBe(true);

    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().general.openInNewTab).toBe(false);
  });
});

describe("settingsStore workspaceRailMode", () => {
  it("defaults workspaceRailMode to false", () => {
    expect(useSettingsStore.getState().general.workspaceRailMode).toBe(false);
  });

  it("toggles workspaceRailMode through general settings", () => {
    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", true);
    expect(useSettingsStore.getState().general.workspaceRailMode).toBe(true);

    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", false);
    expect(useSettingsStore.getState().general.workspaceRailMode).toBe(false);
  });

  it("resets workspaceRailMode to false on resetSettings", () => {
    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", true);
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().general.workspaceRailMode).toBe(false);
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

describe("settingsStore appearance settings", () => {
  it("updates theme", () => {
    useSettingsStore.getState().updateAppearanceSetting("theme", "night");
    expect(useSettingsStore.getState().appearance.theme).toBe("night");
  });

  it("updates fontSize", () => {
    useSettingsStore.getState().updateAppearanceSetting("fontSize", 24);
    expect(useSettingsStore.getState().appearance.fontSize).toBe(24);
  });

  it("updates lineHeight", () => {
    useSettingsStore.getState().updateAppearanceSetting("lineHeight", 2.0);
    expect(useSettingsStore.getState().appearance.lineHeight).toBe(2.0);
  });

  it("updates blockSpacing", () => {
    useSettingsStore.getState().updateAppearanceSetting("blockSpacing", 2);
    expect(useSettingsStore.getState().appearance.blockSpacing).toBe(2);
  });

  it("updates editorWidth", () => {
    useSettingsStore.getState().updateAppearanceSetting("editorWidth", 0);
    expect(useSettingsStore.getState().appearance.editorWidth).toBe(0);
  });

  it("updates showFilenameInTitlebar", () => {
    useSettingsStore.getState().updateAppearanceSetting("showFilenameInTitlebar", true);
    expect(useSettingsStore.getState().appearance.showFilenameInTitlebar).toBe(true);
  });

  it("updates autoHideStatusBar", () => {
    useSettingsStore.getState().updateAppearanceSetting("autoHideStatusBar", true);
    expect(useSettingsStore.getState().appearance.autoHideStatusBar).toBe(true);
  });

  it("resets appearance on resetSettings", () => {
    useSettingsStore.getState().updateAppearanceSetting("theme", "night");
    useSettingsStore.getState().updateAppearanceSetting("fontSize", 24);
    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().appearance.theme).toBe("paper");
    expect(useSettingsStore.getState().appearance.fontSize).toBe(18);
  });
});

describe("settingsStore CJK formatting settings", () => {
  it("updates individual CJK settings", () => {
    useSettingsStore.getState().updateCJKFormattingSetting("ellipsisNormalization", false);
    expect(useSettingsStore.getState().cjkFormatting.ellipsisNormalization).toBe(false);
  });

  it("updates quoteStyle", () => {
    useSettingsStore.getState().updateCJKFormattingSetting("quoteStyle", "corner");
    expect(useSettingsStore.getState().cjkFormatting.quoteStyle).toBe("corner");
  });

  it("updates consecutivePunctuationLimit", () => {
    useSettingsStore.getState().updateCJKFormattingSetting("consecutivePunctuationLimit", 2);
    expect(useSettingsStore.getState().cjkFormatting.consecutivePunctuationLimit).toBe(2);
  });

  it("resets CJK settings on resetSettings", () => {
    useSettingsStore.getState().updateCJKFormattingSetting("quoteStyle", "guillemets");
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().cjkFormatting.quoteStyle).toBe("curly");
  });
});

describe("settingsStore image settings", () => {
  it("updates autoResizeMax", () => {
    useSettingsStore.getState().updateImageSetting("autoResizeMax", 1920);
    expect(useSettingsStore.getState().image.autoResizeMax).toBe(1920);
  });

  it("updates copyToAssets", () => {
    useSettingsStore.getState().updateImageSetting("copyToAssets", false);
    expect(useSettingsStore.getState().image.copyToAssets).toBe(false);
  });

  it("updates cleanupOrphansOnClose", () => {
    useSettingsStore.getState().updateImageSetting("cleanupOrphansOnClose", true);
    expect(useSettingsStore.getState().image.cleanupOrphansOnClose).toBe(true);
  });

  it("resets image settings on resetSettings", () => {
    useSettingsStore.getState().updateImageSetting("autoResizeMax", 1920);
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().image.autoResizeMax).toBe(0);
  });
});

describe("settingsStore terminal settings", () => {
  it("updates terminal fontSize", () => {
    useSettingsStore.getState().updateTerminalSetting("fontSize", 16);
    expect(useSettingsStore.getState().terminal.fontSize).toBe(16);
  });

  it("updates terminal shell", () => {
    useSettingsStore.getState().updateTerminalSetting("shell", "/bin/zsh");
    expect(useSettingsStore.getState().terminal.shell).toBe("/bin/zsh");
  });

  it("updates terminal position", () => {
    useSettingsStore.getState().updateTerminalSetting("position", "right");
    expect(useSettingsStore.getState().terminal.position).toBe("right");
  });

  it("updates terminal panelRatio", () => {
    useSettingsStore.getState().updateTerminalSetting("panelRatio", 0.6);
    expect(useSettingsStore.getState().terminal.panelRatio).toBe(0.6);
  });

  it("resets terminal settings on resetSettings", () => {
    useSettingsStore.getState().updateTerminalSetting("shell", "/bin/zsh");
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().terminal.shell).toBe("");
  });
});

describe("settingsStore update settings", () => {
  it("defaults to auto-check on startup", () => {
    const state = useSettingsStore.getState();
    expect(state.update.autoCheckEnabled).toBe(true);
    expect(state.update.checkFrequency).toBe("startup");
    expect(state.update.autoDownload).toBe(false);
    expect(state.update.lastCheckTimestamp).toBeNull();
    expect(state.update.skipVersion).toBeNull();
  });

  it("updates autoCheckEnabled", () => {
    useSettingsStore.getState().updateUpdateSetting("autoCheckEnabled", false);
    expect(useSettingsStore.getState().update.autoCheckEnabled).toBe(false);
  });

  it("updates checkFrequency", () => {
    useSettingsStore.getState().updateUpdateSetting("checkFrequency", "weekly");
    expect(useSettingsStore.getState().update.checkFrequency).toBe("weekly");
  });

  it("updates skipVersion", () => {
    useSettingsStore.getState().updateUpdateSetting("skipVersion", "1.0.0");
    expect(useSettingsStore.getState().update.skipVersion).toBe("1.0.0");
  });

  it("updates lastCheckTimestamp", () => {
    const ts = Date.now();
    useSettingsStore.getState().updateUpdateSetting("lastCheckTimestamp", ts);
    expect(useSettingsStore.getState().update.lastCheckTimestamp).toBe(ts);
  });

  it("resets update settings on resetSettings", () => {
    useSettingsStore.getState().updateUpdateSetting("skipVersion", "2.0.0");
    useSettingsStore.getState().updateUpdateSetting("autoCheckEnabled", false);
    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().update.skipVersion).toBeNull();
    expect(useSettingsStore.getState().update.autoCheckEnabled).toBe(true);
  });
});

describe("settingsStore toggleDevSection", () => {
  it("toggles dev section visibility", () => {
    expect(useSettingsStore.getState().showDevSection).toBe(false);

    useSettingsStore.getState().toggleDevSection();
    expect(useSettingsStore.getState().showDevSection).toBe(true);

    useSettingsStore.getState().toggleDevSection();
    expect(useSettingsStore.getState().showDevSection).toBe(false);
  });

  it("resets dev section on resetSettings", () => {
    useSettingsStore.getState().toggleDevSection();
    expect(useSettingsStore.getState().showDevSection).toBe(true);

    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState().showDevSection).toBe(false);
  });
});

describe("settingsStore section updater preserves sibling keys", () => {
  it("updating one appearance key preserves others", () => {
    useSettingsStore.getState().updateAppearanceSetting("fontSize", 24);
    useSettingsStore.getState().updateAppearanceSetting("lineHeight", 2.0);

    const appearance = useSettingsStore.getState().appearance;
    expect(appearance.fontSize).toBe(24);
    expect(appearance.lineHeight).toBe(2.0);
    // Other keys should remain at defaults
    expect(appearance.theme).toBe("paper");
    expect(appearance.editorWidth).toBe(50);
  });

  it("updating one markdown key preserves others", () => {
    useSettingsStore.getState().updateMarkdownSetting("pasteMode", "plain");
    useSettingsStore.getState().updateMarkdownSetting("copyOnSelect", true);

    const markdown = useSettingsStore.getState().markdown;
    expect(markdown.pasteMode).toBe("plain");
    expect(markdown.copyOnSelect).toBe(true);
    expect(markdown.enableRegexSearch).toBe(true); // default preserved
  });
});

describe("settingsStore merge — branch coverage", () => {
  it("skips migration when appearance already has blockSpacing (both keys present)", () => {
    // Simulate persisted state where appearance already has blockSpacing — no migration needed
    const storeApi = useSettingsStore as unknown as {
      persist: { getOptions: () => { merge?: (persisted: unknown, current: unknown) => unknown } };
    };
    const options = storeApi.persist.getOptions();
    if (options.merge) {
      const currentState = useSettingsStore.getState();
      const persistedWithBoth = {
        appearance: {
          paragraphSpacing: 1.5,
          blockSpacing: 2,
          theme: "paper",
        },
      };
      const result = options.merge(persistedWithBoth, currentState) as typeof currentState;
      // blockSpacing was already present, so it should use the persisted value (2)
      expect(result.appearance.blockSpacing).toBe(2);
    }
  });

  it("skips migration when appearance has no paragraphSpacing", () => {
    const storeApi = useSettingsStore as unknown as {
      persist: { getOptions: () => { merge?: (persisted: unknown, current: unknown) => unknown } };
    };
    const options = storeApi.persist.getOptions();
    if (options.merge) {
      const currentState = useSettingsStore.getState();
      const persistedNoParagraph = {
        appearance: {
          theme: "night",
          blockSpacing: 3,
        },
      };
      const result = options.merge(persistedNoParagraph, currentState) as typeof currentState;
      expect(result.appearance.blockSpacing).toBe(3);
    }
  });

  it("handles null persistedState gracefully (uses empty object fallback)", () => {
    const storeApi = useSettingsStore as unknown as {
      persist: { getOptions: () => { merge?: (persisted: unknown, current: unknown) => unknown } };
    };
    const options = storeApi.persist.getOptions();
    if (options.merge) {
      const currentState = useSettingsStore.getState();
      // null persisted state — should fallback to {} and merge with defaults
      const result = options.merge(null, currentState) as typeof currentState;
      // Should return current state defaults when nothing is persisted
      expect(result.appearance.blockSpacing).toBe(1);
      expect(result.appearance.theme).toBe("paper");
    }
  });

  it("handles persisted state with no appearance key", () => {
    const storeApi = useSettingsStore as unknown as {
      persist: { getOptions: () => { merge?: (persisted: unknown, current: unknown) => unknown } };
    };
    const options = storeApi.persist.getOptions();
    if (options.merge) {
      const currentState = useSettingsStore.getState();
      // No appearance key at all — no migration should occur
      const result = options.merge({ general: { tabSize: 4 } }, currentState) as typeof currentState;
      expect(result.general.tabSize).toBe(4);
      // blockSpacing remains at default
      expect(result.appearance.blockSpacing).toBe(1);
    }
  });
});

describe("settingsStore paragraphSpacing → blockSpacing migration", () => {
  it("migrates paragraphSpacing to blockSpacing when loading persisted state", () => {
    // Simulate persisted state with old paragraphSpacing key
    const legacyPersistedState = {
      appearance: {
        paragraphSpacing: 2,
        theme: "paper",
        fontSize: 18,
      },
    };
    const storageKey = "vmark-settings";
    localStorage.setItem(
      storageKey,
      JSON.stringify({ state: legacyPersistedState, version: 0 })
    );

    // Force re-hydration by resetting and re-initializing
    // The merge function should convert paragraphSpacing → blockSpacing
    useSettingsStore.persist.rehydrate();

    const appearance = useSettingsStore.getState().appearance;
    expect(appearance.blockSpacing).toBe(2);
  });
});

describe("settingsStore markdown defaults (#618)", () => {
  it("defaults htmlRenderingMode to sanitized so HTML blocks render", () => {
    const { markdown } = useSettingsStore.getState();
    expect(markdown.htmlRenderingMode).toBe("sanitized");
  });

  it("defaults the HTML allow-list to strict with no custom tags (backward compatible)", () => {
    const { markdown } = useSettingsStore.getState();
    expect(markdown.htmlAllowlistLevel).toBe("strict");
    expect(markdown.htmlAllowlistCustomTags).toBe("");
  });

  it("persists allow-list changes through updateMarkdownSetting", () => {
    const { updateMarkdownSetting } = useSettingsStore.getState();
    updateMarkdownSetting("htmlAllowlistLevel", "extended");
    updateMarkdownSetting("htmlAllowlistCustomTags", "kbd, samp");
    const { markdown } = useSettingsStore.getState();
    expect(markdown.htmlAllowlistLevel).toBe("extended");
    expect(markdown.htmlAllowlistCustomTags).toBe("kbd, samp");
  });
});
