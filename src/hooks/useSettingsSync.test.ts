import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { initialState } from "@/stores/settingsStore/defaults";
import { SYNC_GROUPS, handleSettingsStorageEvent } from "./useSettingsSync";

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
  // WI-4.2 — reject malformed cross-tab writes (T3)
  describe("rejects malformed group shapes", () => {
    it("does not corrupt live settings when a group is a non-object", () => {
      const before = useSettingsStore.getState().appearance.theme;
      // A malformed write injects a string where an object group is expected.
      handleSettingsStorageEvent(
        createStorageEvent({ appearance: "not-an-object" as never }),
      );
      // Live settings untouched.
      expect(useSettingsStore.getState().appearance.theme).toBe(before);
      expect(typeof useSettingsStore.getState().appearance).toBe("object");
    });

    it("ignores array and null groups", () => {
      const before = useSettingsStore.getState().general.tabSize;
      handleSettingsStorageEvent(createStorageEvent({ general: [1, 2, 3] as never }));
      handleSettingsStorageEvent(createStorageEvent({ general: null as never }));
      expect(useSettingsStore.getState().general.tabSize).toBe(before);
    });
  });

  // Per-group behavioural checks. Exhaustiveness is NOT established here —
  // these are hand-written samples. The "SYNC_GROUPS covers every persisted
  // settings section" contract test below is what proves full coverage; this
  // block was previously named "syncs all setting groups", which read as a
  // completeness guarantee it never provided and hid three missing groups.
  describe("syncs individual setting groups", () => {
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
        autoPairEnabled: false,
      };

      handleSettingsStorageEvent(createStorageEvent({ markdown: newMarkdown }));

      expect(useSettingsStore.getState().markdown.preserveLineBreaks).toBe(true);
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
            autoPairEnabled: false,
          },
        })
      );

      expect(useSettingsStore.getState().appearance.theme).toBe("night");
      expect(useSettingsStore.getState().general.tabSize).toBe(4);
      expect(useSettingsStore.getState().markdown.autoPairEnabled).toBe(false);
    });

    it("syncs update settings", () => {
      const newUpdate = {
        ...useSettingsStore.getState().update,
        autoCheckEnabled: false,
      };

      handleSettingsStorageEvent(createStorageEvent({ update: newUpdate }));

      expect(useSettingsStore.getState().update.autoCheckEnabled).toBe(false);
    });

    it("syncs formats settings so registry rebootstraps cross-window", () => {
      const newFormats = {
        ...useSettingsStore.getState().formats,
        diagrams: true,
        htmlPreview: true,
        codeViewers: true,
      };

      handleSettingsStorageEvent(createStorageEvent({ formats: newFormats }));

      expect(useSettingsStore.getState().formats.diagrams).toBe(true);
      expect(useSettingsStore.getState().formats.htmlPreview).toBe(true);
      expect(useSettingsStore.getState().formats.codeViewers).toBe(true);
    });

    it("does not call setState when no values changed", () => {
      // Send the exact current values — no update should occur
      const spy = vi.spyOn(useSettingsStore, "setState");
      const currentAppearance = useSettingsStore.getState().appearance;

      handleSettingsStorageEvent(
        createStorageEvent({ appearance: currentAppearance })
      );

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("skips groups not present in the incoming event", () => {
      const spy = vi.spyOn(useSettingsStore, "setState");

      // Send an event with an empty state object — no groups to sync
      handleSettingsStorageEvent(
        createStorageEvent({})
      );

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

describe("SYNC_GROUPS covers every persisted settings section", () => {
  // Regression: the list was hand-maintained and silently omitted `terminal`,
  // `largeFile` and `browser`. Because persist has no `partialize`, a window
  // that skips a group later writes its whole stale state back over it — so a
  // missing group is silent DATA LOSS, not just staleness. Deriving the list
  // from the store makes the drift unrepresentable; this test pins that.
  it("syncs every object-valued key of SettingsState", () => {
    const sections = Object.keys(initialState).filter(
      (key) =>
        typeof initialState[key as keyof typeof initialState] === "object" &&
        initialState[key as keyof typeof initialState] !== null,
    );

    expect([...SYNC_GROUPS].sort()).toEqual(sections.sort());
  });

  it.each(["terminal", "largeFile", "browser"] as const)(
    "propagates the %s group (previously dropped)",
    (group) => {
      expect(SYNC_GROUPS).toContain(group);
    },
  );

  it("applies a terminal font-size change from another window", () => {
    const incoming = { ...useSettingsStore.getState().terminal, fontSize: 20 };

    handleSettingsStorageEvent(createStorageEvent({ terminal: incoming }));

    expect(useSettingsStore.getState().terminal.fontSize).toBe(20);
  });

  it("applies a browser enable/posture change from another window", () => {
    const incoming = {
      ...useSettingsStore.getState().browser,
      enabled: true,
      aiSession: "sandbox" as const,
    };

    handleSettingsStorageEvent(createStorageEvent({ browser: incoming }));

    expect(useSettingsStore.getState().browser.enabled).toBe(true);
    expect(useSettingsStore.getState().browser.aiSession).toBe("sandbox");
  });

  it("applies a largeFile threshold change from another window", () => {
    const before = useSettingsStore.getState().largeFile.autoSourceMode;
    const incoming = {
      ...useSettingsStore.getState().largeFile,
      autoSourceMode: !before,
    };

    handleSettingsStorageEvent(createStorageEvent({ largeFile: incoming }));

    expect(useSettingsStore.getState().largeFile.autoSourceMode).toBe(!before);
  });
});

describe("applies the same trust boundary as hydration", () => {
  // C4: the sync path used a raw setState, so a value that hydration would
  // clamp was accepted live from another window — the one hole in the D4
  // defence. Both routes now share reconcileSettings().
  it("clamps an out-of-range numeric from another window", () => {
    const incoming = { ...useSettingsStore.getState().appearance, fontSize: 9999 };

    handleSettingsStorageEvent(createStorageEvent({ appearance: incoming }));

    const applied = useSettingsStore.getState().appearance.fontSize;
    expect(applied).toBeLessThan(9999);
    expect(applied).toBeGreaterThan(0);
  });

  it("normalizes an invalid browser posture to the safe mode", () => {
    const incoming = {
      ...useSettingsStore.getState().browser,
      aiSession: "totally-invalid" as never,
    };

    handleSettingsStorageEvent(createStorageEvent({ browser: incoming }));

    expect(useSettingsStore.getState().browser.aiSession).toBe("sandbox");
  });

  it("drops a type-mismatched leaf instead of poisoning the store", () => {
    const before = useSettingsStore.getState().general.tabSize;
    const incoming = { ...useSettingsStore.getState().general, tabSize: "four" as never };

    handleSettingsStorageEvent(createStorageEvent({ general: incoming }));

    expect(useSettingsStore.getState().general.tabSize).toBe(before);
  });

  it("drops non-string customLinkProtocols elements from another window", () => {
    // audit Medium-10: hydration filtered these but the storage path did not,
    // so the two untrusted routes applied unequal validation.
    const incoming = {
      ...useSettingsStore.getState().advanced,
      customLinkProtocols: ["obsidian", 42, null, {}, "vscode"] as never,
    };

    handleSettingsStorageEvent(createStorageEvent({ advanced: incoming }));

    const protocols = useSettingsStore.getState().advanced.customLinkProtocols;
    expect(protocols).toEqual(protocols.filter((p) => typeof p === "string"));
    expect(protocols).toContain("obsidian");
    expect(protocols).toContain("vscode");
    expect(protocols.every((p) => typeof p === "string")).toBe(true);
  });

  it("defaults keys the writer omitted rather than dropping them", () => {
    // setState replaced a group wholesale; a key absent from the writer's blob
    // vanished instead of keeping its default. A deep merge defaults it.
    const before = useSettingsStore.getState().terminal.cursorStyle;

    handleSettingsStorageEvent(createStorageEvent({ terminal: { fontSize: 17 } }));

    expect(useSettingsStore.getState().terminal.fontSize).toBe(17);
    expect(useSettingsStore.getState().terminal.cursorStyle).toBe(before);
  });
});

describe("useSettingsSync hook", () => {
  it("adds and removes storage event listener", async () => {
    const { renderHook } = await import("@testing-library/react");
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { useSettingsSync } = await import("./useSettingsSync");
    const { unmount } = renderHook(() => useSettingsSync());

    expect(addSpy).toHaveBeenCalledWith("storage", expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("storage", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
