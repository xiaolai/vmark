import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { handleSettingsStorageEvent } from "./useSettingsSync";

// Helper to create a storage event with settings
function createStorageEvent(newSettings: Record<string, unknown>): StorageEvent {
  return new StorageEvent("storage", {
    key: "vmark-settings",
    newValue: JSON.stringify({ state: newSettings }),
  });
}

beforeEach(() => {
  useSettingsStore.getState().resetSettings();
});

describe("useSettingsSync cross-window sync", () => {
  describe("syncs all setting groups", () => {
    it("syncs appearance settings", () => {
      const newAppearance = {
        ...useSettingsStore.getState().appearance,
        theme: "night" as const,
        fontSize: 20,
        latinFont: "georgia",
        cjkFont: "songti",
        monoFont: "firacode",
      };

      handleSettingsStorageEvent(createStorageEvent({ appearance: newAppearance }));

      expect(useSettingsStore.getState().appearance.theme).toBe("night");
      expect(useSettingsStore.getState().appearance.fontSize).toBe(20);
      expect(useSettingsStore.getState().appearance.latinFont).toBe("georgia");
      expect(useSettingsStore.getState().appearance.cjkFont).toBe("songti");
      expect(useSettingsStore.getState().appearance.monoFont).toBe("firacode");
    });

    it("syncs general settings", () => {
      const newGeneral = {
        ...useSettingsStore.getState().general,
        autoSaveEnabled: false,
        autoSaveInterval: 60,
        tabSize: 4,
      };

      handleSettingsStorageEvent(createStorageEvent({ general: newGeneral }));

      expect(useSettingsStore.getState().general.autoSaveEnabled).toBe(false);
      expect(useSettingsStore.getState().general.autoSaveInterval).toBe(60);
      expect(useSettingsStore.getState().general.tabSize).toBe(4);
    });

    it("syncs markdown settings", () => {
      const newMarkdown = {
        ...useSettingsStore.getState().markdown,
        preserveLineBreaks: true,
        spellCheckEnabled: true,
        autoPairEnabled: false,
      };

      handleSettingsStorageEvent(createStorageEvent({ markdown: newMarkdown }));

      expect(useSettingsStore.getState().markdown.preserveLineBreaks).toBe(true);
      expect(useSettingsStore.getState().markdown.spellCheckEnabled).toBe(true);
      expect(useSettingsStore.getState().markdown.autoPairEnabled).toBe(false);
    });

    it("syncs image settings", () => {
      const newImage = {
        ...useSettingsStore.getState().image,
        autoResizeMax: 1920 as const,
        copyToAssets: false,
      };

      handleSettingsStorageEvent(createStorageEvent({ image: newImage }));

      expect(useSettingsStore.getState().image.autoResizeMax).toBe(1920);
      expect(useSettingsStore.getState().image.copyToAssets).toBe(false);
    });

    it("syncs cjkFormatting settings", () => {
      const newCjkFormatting = {
        ...useSettingsStore.getState().cjkFormatting,
        cjkEnglishSpacing: false,
        fullwidthPunctuation: false,
      };

      handleSettingsStorageEvent(createStorageEvent({ cjkFormatting: newCjkFormatting }));

      expect(useSettingsStore.getState().cjkFormatting.cjkEnglishSpacing).toBe(false);
      expect(useSettingsStore.getState().cjkFormatting.fullwidthPunctuation).toBe(false);
    });

    it("syncs advanced settings", () => {
      const newAdvanced = {
        ...useSettingsStore.getState().advanced,
        customLinkProtocols: ["x-callback", "obsidian"],
      };

      handleSettingsStorageEvent(createStorageEvent({ advanced: newAdvanced }));

      expect(useSettingsStore.getState().advanced.customLinkProtocols).toEqual(["x-callback", "obsidian"]);
    });
  });

  describe("handles edge cases", () => {
    it("ignores storage events for other keys", () => {
      const initialTheme = useSettingsStore.getState().appearance.theme;

      const event = new StorageEvent("storage", {
        key: "other-key",
        newValue: JSON.stringify({ state: { appearance: { theme: "night" } } }),
      });
      handleSettingsStorageEvent(event);

      expect(useSettingsStore.getState().appearance.theme).toBe(initialTheme);
    });

    it("ignores malformed JSON", () => {
      const initialTheme = useSettingsStore.getState().appearance.theme;

      const event = new StorageEvent("storage", {
        key: "vmark-settings",
        newValue: "not valid json",
      });
      handleSettingsStorageEvent(event);

      expect(useSettingsStore.getState().appearance.theme).toBe(initialTheme);
    });

    it("ignores null newValue", () => {
      const initialTheme = useSettingsStore.getState().appearance.theme;

      const event = new StorageEvent("storage", {
        key: "vmark-settings",
        newValue: null,
      });
      handleSettingsStorageEvent(event);

      expect(useSettingsStore.getState().appearance.theme).toBe(initialTheme);
    });

    it("ignores events without state property", () => {
      const initialTheme = useSettingsStore.getState().appearance.theme;

      const event = new StorageEvent("storage", {
        key: "vmark-settings",
        newValue: JSON.stringify({ appearance: { theme: "night" } }), // No state wrapper
      });
      handleSettingsStorageEvent(event);

      expect(useSettingsStore.getState().appearance.theme).toBe(initialTheme);
    });

    it("only updates changed settings", () => {
      // Set up initial state
      useSettingsStore.getState().updateAppearanceSetting("fontSize", 16);

      // Simulate sync with same fontSize but different theme
      handleSettingsStorageEvent(
        createStorageEvent({
          appearance: {
            ...useSettingsStore.getState().appearance,
            theme: "night",
            fontSize: 16, // same as current
          },
        })
      );

      // Both should be updated to new values
      expect(useSettingsStore.getState().appearance.theme).toBe("night");
      expect(useSettingsStore.getState().appearance.fontSize).toBe(16);
    });

    it("syncs multiple setting groups in one event", () => {
      handleSettingsStorageEvent(
        createStorageEvent({
          appearance: {
            ...useSettingsStore.getState().appearance,
            theme: "night",
          },
          general: {
            ...useSettingsStore.getState().general,
            tabSize: 4,
          },
          markdown: {
            ...useSettingsStore.getState().markdown,
            spellCheckEnabled: true,
          },
        })
      );

      expect(useSettingsStore.getState().appearance.theme).toBe("night");
      expect(useSettingsStore.getState().general.tabSize).toBe(4);
      expect(useSettingsStore.getState().markdown.spellCheckEnabled).toBe(true);
    });
  });
});
