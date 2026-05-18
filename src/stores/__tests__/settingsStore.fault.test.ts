/**
 * Fault Injection Tests for settingsStore
 *
 * Verifies recovery behavior when localStorage contains corrupted JSON,
 * missing fields, or unexpected extra fields.
 *
 * @module stores/__tests__/settingsStore.fault.test
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { deepMerge } from "@/utils/deepMerge";

// We test the deepMerge + persist merge logic directly because
// zustand/persist rehydration is async and tightly coupled to the
// module-level store creation. Testing the merge function that the
// store uses gives us deterministic coverage of the recovery paths.

// Import store for integration-level tests
import { useSettingsStore } from "../settingsStore";

describe("settingsStore — corrupted config recovery", () => {
  const STORAGE_KEY = "vmark-settings";

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Reset store to defaults
    useSettingsStore.getState().resetSettings();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("corrupted JSON in localStorage", () => {
    it("store hydrates with defaults when localStorage has invalid JSON", () => {
      // Simulate corrupted JSON
      localStorage.setItem(STORAGE_KEY, "{{{broken json!!!");

      // Force rehydration
      useSettingsStore.persist.rehydrate();

      // Store should have default values (rehydration fails, zustand falls back)
      const state = useSettingsStore.getState();
      expect(state.general.autoSaveEnabled).toBe(true);
      expect(state.appearance.theme).toBe("paper");
      expect(state.appearance.fontSize).toBe(18);
    });

    it("store hydrates with defaults when localStorage has empty string", () => {
      localStorage.setItem(STORAGE_KEY, "");

      useSettingsStore.persist.rehydrate();

      const state = useSettingsStore.getState();
      expect(state.general.autoSaveEnabled).toBe(true);
      expect(state.appearance.theme).toBe("paper");
    });

    it("store hydrates with defaults when localStorage has null string", () => {
      localStorage.setItem(STORAGE_KEY, "null");

      useSettingsStore.persist.rehydrate();

      const state = useSettingsStore.getState();
      expect(state.general.autoSaveEnabled).toBe(true);
      expect(state.appearance.theme).toBe("paper");
    });

    it("store hydrates with defaults when localStorage has number", () => {
      localStorage.setItem(STORAGE_KEY, "42");

      useSettingsStore.persist.rehydrate();

      const state = useSettingsStore.getState();
      expect(state.appearance.fontSize).toBe(18);
    });

    it("store hydrates with defaults when localStorage has array", () => {
      localStorage.setItem(STORAGE_KEY, "[1, 2, 3]");

      useSettingsStore.persist.rehydrate();

      const state = useSettingsStore.getState();
      expect(state.general.autoSaveEnabled).toBe(true);
    });
  });

  describe("missing fields in stored data (deepMerge recovery)", () => {
    it("fills missing section with defaults", () => {
      const defaults = {
        general: { autoSaveEnabled: true, autoSaveInterval: 30 },
        appearance: { theme: "paper", fontSize: 18 },
      };
      const stored = {
        general: { autoSaveEnabled: false },
        // appearance section entirely missing
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      // general.autoSaveEnabled overridden by stored value
      expect((result as typeof defaults).general.autoSaveEnabled).toBe(false);
      // general.autoSaveInterval preserved from default
      expect((result as typeof defaults).general.autoSaveInterval).toBe(30);
      // appearance preserved from defaults
      expect((result as typeof defaults).appearance.theme).toBe("paper");
      expect((result as typeof defaults).appearance.fontSize).toBe(18);
    });

    it("fills missing individual keys within a section", () => {
      const defaults = {
        markdown: {
          preserveLineBreaks: false,
          showBrTags: false,
          enableRegexSearch: true,
          lintEnabled: true,
        },
      };
      const stored = {
        markdown: {
          preserveLineBreaks: true,
          // showBrTags, enableRegexSearch, lintEnabled missing
        },
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      expect((result as typeof defaults).markdown.preserveLineBreaks).toBe(true);
      expect((result as typeof defaults).markdown.showBrTags).toBe(false);
      expect((result as typeof defaults).markdown.enableRegexSearch).toBe(true);
      expect((result as typeof defaults).markdown.lintEnabled).toBe(true);
    });

    it("fills in newly added settings when upgrading from older version", () => {
      // Simulates user upgrading — stored data lacks new fields
      const defaults = {
        general: { autoSaveEnabled: true, language: "en" },
        terminal: { shell: "", fontSize: 13, position: "auto", panelRatio: 0.4 },
        advanced: { mcpServer: { port: 9223, autoStart: true, autoApproveEdits: false } },
      };
      const stored = {
        general: { autoSaveEnabled: false },
        // terminal and advanced sections entirely missing (old version didn't have them)
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      expect((result as typeof defaults).general.autoSaveEnabled).toBe(false);
      expect((result as typeof defaults).general.language).toBe("en");
      expect((result as typeof defaults).terminal.fontSize).toBe(13);
      expect((result as typeof defaults).terminal.position).toBe("auto");
      expect((result as typeof defaults).advanced.mcpServer.port).toBe(9223);
    });

    it("preserves null-safe defaults when stored has null values", () => {
      const defaults = {
        general: { autoSaveEnabled: true, autoSaveInterval: 30 },
      };
      const stored = {
        general: { autoSaveEnabled: null, autoSaveInterval: null },
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      // null values should be skipped — defaults preserved
      expect((result as typeof defaults).general.autoSaveEnabled).toBe(true);
      expect((result as typeof defaults).general.autoSaveInterval).toBe(30);
    });
  });

  describe("extra unknown fields in stored data", () => {
    it("ignores extra top-level fields not in defaults", () => {
      const defaults = {
        general: { autoSaveEnabled: true },
      };
      const stored = {
        general: { autoSaveEnabled: false },
        obsoleteSection: { foo: "bar" },
        randomField: 42,
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      // Known field is merged
      expect((result as typeof defaults).general.autoSaveEnabled).toBe(false);
      // Extra fields end up in result (deepMerge copies them) but won't
      // affect typed access — the store's TypeScript types ignore them
      expect((result as Record<string, unknown>).obsoleteSection).toEqual({ foo: "bar" });
      expect((result as Record<string, unknown>).randomField).toBe(42);
    });

    it("ignores extra nested fields within a known section", () => {
      const defaults = {
        appearance: { theme: "paper", fontSize: 18 },
      };
      const stored = {
        appearance: { theme: "night", fontSize: 16, deletedSetting: "old-value" },
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      expect((result as typeof defaults).appearance.theme).toBe("night");
      expect((result as typeof defaults).appearance.fontSize).toBe(16);
      // Extra field is present in the merged object but harmless
      expect((result as Record<string, unknown>).appearance).toHaveProperty("deletedSetting", "old-value");
    });
  });

  describe("paragraphSpacing → blockSpacing migration", () => {
    it("migrates paragraphSpacing to blockSpacing in the persist merge function", () => {
      // Simulate old stored data with paragraphSpacing instead of blockSpacing
      const storedData = {
        state: {
          appearance: {
            theme: "night",
            fontSize: 20,
            paragraphSpacing: 1.5,
            // no blockSpacing field
          },
          general: { autoSaveEnabled: true },
        },
        version: 0,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedData));
      useSettingsStore.persist.rehydrate();

      const state = useSettingsStore.getState();
      // blockSpacing should be migrated from paragraphSpacing
      expect(state.appearance.blockSpacing).toBe(1.5);
      expect(state.appearance.theme).toBe("night");
      expect(state.appearance.fontSize).toBe(20);
    });

    it("does not overwrite blockSpacing if both fields exist", () => {
      const storedData = {
        state: {
          appearance: {
            theme: "paper",
            blockSpacing: 2,
            paragraphSpacing: 0.5, // old field — should be ignored since blockSpacing exists
          },
        },
        version: 0,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedData));
      useSettingsStore.persist.rehydrate();

      const state = useSettingsStore.getState();
      expect(state.appearance.blockSpacing).toBe(2);
    });
  });

  describe("integration: store survives complete corruption", () => {
    it("remains functional after corrupted rehydration", () => {
      localStorage.setItem(STORAGE_KEY, "CORRUPTED!");

      useSettingsStore.persist.rehydrate();

      // Store should be functional with defaults
      const state = useSettingsStore.getState();
      expect(state.general.autoSaveEnabled).toBe(true);

      // Should be able to update settings normally
      state.updateGeneralSetting("autoSaveEnabled", false);
      expect(useSettingsStore.getState().general.autoSaveEnabled).toBe(false);
    });

    it("can persist and reload after recovering from corruption", () => {
      // First: corrupt the storage
      localStorage.setItem(STORAGE_KEY, "NOT JSON");
      useSettingsStore.persist.rehydrate();

      // Modify a setting (triggers persist to localStorage)
      useSettingsStore.getState().updateAppearanceSetting("theme", "night");

      // Read back from store
      const state = useSettingsStore.getState();
      expect(state.appearance.theme).toBe("night");

      // Verify localStorage now has valid data
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(() => JSON.parse(raw!)).not.toThrow();
    });

    it("resetSettings restores all defaults after partial corruption", () => {
      // Store some weird partial data
      const partialData = {
        state: {
          general: { autoSaveEnabled: false },
          // Missing all other sections
        },
        version: 0,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(partialData));
      useSettingsStore.persist.rehydrate();

      // Reset
      useSettingsStore.getState().resetSettings();

      const state = useSettingsStore.getState();
      expect(state.general.autoSaveEnabled).toBe(true);
      expect(state.general.autoSaveInterval).toBe(30);
      expect(state.appearance.theme).toBe("paper");
      expect(state.appearance.fontSize).toBe(18);
      expect(state.markdown.lintEnabled).toBe(true);
      expect(state.terminal.fontSize).toBe(13);
    });
  });

  describe("edge cases", () => {
    it("handles stored data where a section is a non-object (e.g., string)", () => {
      const defaults = {
        general: { autoSaveEnabled: true, autoSaveInterval: 30 },
      };
      const stored = {
        general: "not an object",
      };

      // deepMerge should replace the object with the string
      // (not crash trying to deep-merge into a string)
      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      expect((result as Record<string, unknown>).general).toBe("not an object");
    });

    it("handles stored data with deeply nested null", () => {
      const defaults = {
        advanced: { mcpServer: { port: 9223, autoStart: true } },
      };
      const stored = {
        advanced: { mcpServer: null },
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      // null is skipped by deepMerge — defaults preserved
      expect((result as typeof defaults).advanced.mcpServer.port).toBe(9223);
    });

    it("handles empty object in localStorage", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: {}, version: 0 }));

      useSettingsStore.persist.rehydrate();

      // All defaults should be present
      const state = useSettingsStore.getState();
      expect(state.general.autoSaveEnabled).toBe(true);
      expect(state.appearance.theme).toBe("paper");
      expect(state.markdown.lintEnabled).toBe(true);
    });

    it("handles boolean false values preserved correctly (not treated as missing)", () => {
      const defaults = {
        general: { autoSaveEnabled: true, confirmQuit: true },
      };
      const stored = {
        general: { autoSaveEnabled: false, confirmQuit: false },
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      // false should override true (not be skipped)
      expect((result as typeof defaults).general.autoSaveEnabled).toBe(false);
      expect((result as typeof defaults).general.confirmQuit).toBe(false);
    });

    it("handles zero values preserved correctly (not treated as missing)", () => {
      const defaults = {
        appearance: { fontSize: 18, editorWidth: 50 },
      };
      const stored = {
        appearance: { fontSize: 0, editorWidth: 0 },
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      // 0 should override defaults
      expect((result as typeof defaults).appearance.fontSize).toBe(0);
      expect((result as typeof defaults).appearance.editorWidth).toBe(0);
    });

    it("handles empty string values preserved correctly", () => {
      const defaults = {
        terminal: { shell: "zsh" },
      };
      const stored = {
        terminal: { shell: "" },
      };

      const result = deepMerge(
        defaults as Record<string, unknown>,
        stored as Record<string, unknown>
      );

      // "" should override "zsh"
      expect((result as typeof defaults).terminal.shell).toBe("");
    });
  });

  /**
   * Direct tests for the `migrate` callback registered with zustand/persist.
   * Reaching into `persist.getOptions().migrate` lets us assert each branch
   * (valid v1, future version, malformed version) without relying on a
   * full rehydrate cycle (which can be flaky across test environments).
   */
  describe("persist.migrate version handling", () => {
    function migrate(persistedState: unknown, version: number): unknown {
      const opts = useSettingsStore.persist.getOptions();
      // `migrate` is registered in settingsStore.ts; assert it exists so a
      // regression that drops it surfaces as a clear failure here rather
      // than a confusing later runtime crash.
      expect(typeof opts.migrate).toBe("function");
      return opts.migrate!(persistedState, version);
    }

    it("returns the persisted state unchanged for the current version (1)", () => {
      const blob = { general: { autoSaveEnabled: false } };
      expect(migrate(blob, 1)).toEqual(blob);
    });

    it("returns the persisted state unchanged for an older version (0)", () => {
      // Treat pre-versioning blobs the same as v1 — the deep-merge step
      // handles any missing fields.
      const blob = { general: { autoSaveEnabled: true } };
      expect(migrate(blob, 0)).toEqual(blob);
    });

    it("drops the persisted state when the version is from the future", () => {
      // Downgrade scenario: a newer build wrote shape v2; current binary
      // doesn't know v2. Returning undefined tells zustand to keep the
      // in-memory defaults instead of merging a possibly-corrupt blob.
      expect(migrate({ general: { autoSaveEnabled: false } }, 2)).toBeUndefined();
      expect(migrate({ general: { autoSaveEnabled: false } }, 99)).toBeUndefined();
    });

    it("drops the persisted state when the version is not a number", () => {
      // Defends against a tampered/corrupt version field.
      expect(migrate({ general: {} }, "1" as unknown as number)).toBeUndefined();
      expect(migrate({ general: {} }, null as unknown as number)).toBeUndefined();
    });
  });
});
