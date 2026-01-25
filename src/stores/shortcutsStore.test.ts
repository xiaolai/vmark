/**
 * Tests for shortcuts store.
 *
 * Verifies keyboard shortcut management, customization, and conflict detection.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useShortcutsStore,
  DEFAULT_SHORTCUTS,
  SHORTCUT_PRESETS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  getShortcutsByCategory,
  formatKeyForDisplay,
} from "./shortcutsStore";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock platform detection
vi.mock("@/utils/shortcutMatch", () => ({
  isMacPlatform: vi.fn(() => true),
}));

describe("shortcutsStore", () => {
  beforeEach(() => {
    // Reset store state
    useShortcutsStore.setState({
      customBindings: {},
      version: 1,
    });
  });

  describe("DEFAULT_SHORTCUTS", () => {
    it("contains expected shortcuts", () => {
      expect(DEFAULT_SHORTCUTS.length).toBeGreaterThan(50);
    });

    it("has unique IDs", () => {
      const ids = DEFAULT_SHORTCUTS.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("all have required fields", () => {
      for (const shortcut of DEFAULT_SHORTCUTS) {
        expect(shortcut.id).toBeDefined();
        expect(shortcut.label).toBeDefined();
        expect(shortcut.category).toBeDefined();
        expect(shortcut.defaultKey).toBeDefined();
      }
    });

    it("includes common formatting shortcuts", () => {
      const ids = DEFAULT_SHORTCUTS.map((s) => s.id);
      expect(ids).toContain("bold");
      expect(ids).toContain("italic");
      expect(ids).toContain("code");
      expect(ids).toContain("link");
    });

    it("includes file operations", () => {
      const ids = DEFAULT_SHORTCUTS.map((s) => s.id);
      expect(ids).toContain("newFile");
      expect(ids).toContain("openFile");
      expect(ids).toContain("save");
      expect(ids).toContain("saveAs");
    });
  });

  describe("getShortcut", () => {
    it("returns default key for non-customized shortcut", () => {
      const { getShortcut } = useShortcutsStore.getState();
      expect(getShortcut("bold")).toBe("Mod-b");
      expect(getShortcut("italic")).toBe("Mod-i");
    });

    it("returns custom key when set", () => {
      const { setShortcut, getShortcut } = useShortcutsStore.getState();
      setShortcut("bold", "Mod-Shift-b");
      expect(getShortcut("bold")).toBe("Mod-Shift-b");
    });

    it("returns empty string for unknown shortcut", () => {
      const { getShortcut } = useShortcutsStore.getState();
      expect(getShortcut("nonexistent")).toBe("");
    });
  });

  describe("getAllShortcuts", () => {
    it("returns all shortcuts as a map", () => {
      const { getAllShortcuts } = useShortcutsStore.getState();
      const shortcuts = getAllShortcuts();

      expect(typeof shortcuts).toBe("object");
      expect(shortcuts.bold).toBe("Mod-b");
      expect(shortcuts.italic).toBe("Mod-i");
      expect(shortcuts.save).toBe("Mod-s");
    });

    it("includes custom bindings", () => {
      const { setShortcut, getAllShortcuts } = useShortcutsStore.getState();
      setShortcut("bold", "Mod-Alt-b");

      const shortcuts = getAllShortcuts();
      expect(shortcuts.bold).toBe("Mod-Alt-b");
    });
  });

  describe("setShortcut", () => {
    it("sets custom shortcut", () => {
      const { setShortcut, getShortcut } = useShortcutsStore.getState();
      setShortcut("bold", "Ctrl-b");
      expect(getShortcut("bold")).toBe("Ctrl-b");
    });

    it("marks shortcut as customized", () => {
      const { setShortcut, isCustomized } = useShortcutsStore.getState();
      expect(isCustomized("bold")).toBe(false);
      setShortcut("bold", "Ctrl-b");
      expect(isCustomized("bold")).toBe(true);
    });
  });

  describe("resetShortcut", () => {
    it("resets single shortcut to default", () => {
      const { setShortcut, resetShortcut, getShortcut } = useShortcutsStore.getState();
      setShortcut("bold", "Ctrl-b");
      resetShortcut("bold");
      expect(getShortcut("bold")).toBe("Mod-b");
    });

    it("marks shortcut as not customized", () => {
      const { setShortcut, resetShortcut, isCustomized } = useShortcutsStore.getState();
      setShortcut("bold", "Ctrl-b");
      expect(isCustomized("bold")).toBe(true);
      resetShortcut("bold");
      expect(isCustomized("bold")).toBe(false);
    });

    it("does not affect other shortcuts", () => {
      const { setShortcut, resetShortcut, getShortcut } = useShortcutsStore.getState();
      setShortcut("bold", "Ctrl-b");
      setShortcut("italic", "Ctrl-i");
      resetShortcut("bold");
      expect(getShortcut("italic")).toBe("Ctrl-i");
    });
  });

  describe("resetAllShortcuts", () => {
    it("resets all custom bindings", () => {
      const { setShortcut, resetAllShortcuts, getShortcut, isCustomized } = useShortcutsStore.getState();
      setShortcut("bold", "Ctrl-b");
      setShortcut("italic", "Ctrl-i");
      setShortcut("code", "Ctrl-e");

      resetAllShortcuts();

      expect(getShortcut("bold")).toBe("Mod-b");
      expect(getShortcut("italic")).toBe("Mod-i");
      expect(isCustomized("bold")).toBe(false);
      expect(isCustomized("italic")).toBe(false);
    });
  });

  describe("getConflict", () => {
    it("returns null when no conflict", () => {
      const { getConflict } = useShortcutsStore.getState();
      const conflict = getConflict("Mod-Alt-Shift-z");
      expect(conflict).toBeNull();
    });

    it("detects conflict with default shortcut", () => {
      const { getConflict } = useShortcutsStore.getState();
      const conflict = getConflict("Mod-b"); // conflicts with bold
      expect(conflict).not.toBeNull();
      expect(conflict?.id).toBe("bold");
    });

    it("detects conflict with custom shortcut", () => {
      const { setShortcut, getConflict } = useShortcutsStore.getState();
      setShortcut("bold", "Mod-Alt-x");

      const conflict = getConflict("Mod-Alt-x");
      expect(conflict).not.toBeNull();
      expect(conflict?.id).toBe("bold");
    });

    it("excludes specified shortcut from conflict check", () => {
      const { getConflict } = useShortcutsStore.getState();
      // Check if Mod-b conflicts, but exclude bold
      const conflict = getConflict("Mod-b", "bold");
      expect(conflict).toBeNull();
    });

    it("normalizes key for comparison", () => {
      const { getConflict } = useShortcutsStore.getState();
      // Different case/order should still detect conflict
      const conflict = getConflict("mod-B"); // vs Mod-b
      expect(conflict).not.toBeNull();
    });
  });

  describe("applyPreset", () => {
    it("applies preset bindings", () => {
      const { applyPreset, getShortcut } = useShortcutsStore.getState();
      applyPreset("vscode");

      // VS Code preset overrides toggleSidebar
      expect(getShortcut("toggleSidebar")).toBe("Mod-b");
    });

    it("does nothing for unknown preset", () => {
      const { applyPreset, getShortcut } = useShortcutsStore.getState();
      applyPreset("nonexistent");

      // Should remain at default
      expect(getShortcut("bold")).toBe("Mod-b");
    });

    it("clears previous customizations when applying preset", () => {
      const { setShortcut, applyPreset, isCustomized } = useShortcutsStore.getState();
      setShortcut("bold", "Ctrl-b");
      expect(isCustomized("bold")).toBe(true);

      applyPreset("default");
      expect(isCustomized("bold")).toBe(false);
    });
  });

  describe("exportConfig / importConfig", () => {
    it("exports config as JSON", () => {
      const { setShortcut, exportConfig } = useShortcutsStore.getState();
      setShortcut("bold", "Ctrl-b");

      const json = exportConfig();
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(1);
      expect(parsed.customBindings.bold).toBe("Ctrl-b");
    });

    it("imports valid config", () => {
      const { importConfig, getShortcut } = useShortcutsStore.getState();
      const config = JSON.stringify({
        version: 1,
        customBindings: { bold: "Ctrl-b", italic: "Ctrl-i" },
      });

      const result = importConfig(config);
      expect(result.success).toBe(true);
      expect(getShortcut("bold")).toBe("Ctrl-b");
      expect(getShortcut("italic")).toBe("Ctrl-i");
    });

    it("rejects invalid JSON", () => {
      const { importConfig } = useShortcutsStore.getState();
      const result = importConfig("not valid json");
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("rejects config without customBindings", () => {
      const { importConfig } = useShortcutsStore.getState();
      const result = importConfig(JSON.stringify({ version: 1 }));
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Invalid config format");
    });

    it("warns about unknown shortcut IDs", () => {
      const { importConfig } = useShortcutsStore.getState();
      const result = importConfig(JSON.stringify({
        version: 1,
        customBindings: { unknownId: "Ctrl-x" },
      }));
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.includes("Unknown shortcut"))).toBe(true);
    });

    it("warns about invalid key values", () => {
      const { importConfig } = useShortcutsStore.getState();
      const result = importConfig(JSON.stringify({
        version: 1,
        customBindings: { bold: 123 }, // Should be string
      }));
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.includes("Invalid key"))).toBe(true);
    });
  });

  describe("getDefinition", () => {
    it("returns shortcut definition by ID", () => {
      const { getDefinition } = useShortcutsStore.getState();
      const def = getDefinition("bold");

      expect(def).toBeDefined();
      expect(def?.id).toBe("bold");
      expect(def?.label).toBe("Bold");
      expect(def?.defaultKey).toBe("Mod-b");
    });

    it("returns undefined for unknown ID", () => {
      const { getDefinition } = useShortcutsStore.getState();
      expect(getDefinition("nonexistent")).toBeUndefined();
    });
  });

  describe("SHORTCUT_PRESETS", () => {
    it("has default preset", () => {
      expect(SHORTCUT_PRESETS.default).toBeDefined();
      expect(SHORTCUT_PRESETS.default.name).toBeDefined();
    });

    it("has vscode preset", () => {
      expect(SHORTCUT_PRESETS.vscode).toBeDefined();
      expect(SHORTCUT_PRESETS.vscode.name).toBe("VS Code");
    });
  });

  describe("getShortcutsByCategory", () => {
    it("returns shortcuts for category", () => {
      const formatting = getShortcutsByCategory("formatting");
      expect(formatting.length).toBeGreaterThan(0);
      expect(formatting.every((s) => s.category === "formatting")).toBe(true);
    });

    it("returns empty array for invalid category", () => {
      const result = getShortcutsByCategory("nonexistent" as never);
      expect(result).toEqual([]);
    });
  });

  describe("CATEGORY_LABELS", () => {
    it("has labels for all categories", () => {
      for (const category of CATEGORY_ORDER) {
        expect(CATEGORY_LABELS[category]).toBeDefined();
      }
    });
  });

  describe("formatKeyForDisplay", () => {
    it("formats macOS shortcuts", () => {
      // Mock is set to macOS
      expect(formatKeyForDisplay("Mod-b")).toBe("⌘B");
      expect(formatKeyForDisplay("Mod-Shift-b")).toBe("⌘⇧B");
      expect(formatKeyForDisplay("Alt-Mod-b")).toBe("⌥⌘B");
    });

    it("handles special keys", () => {
      expect(formatKeyForDisplay("Mod-Backspace")).toBe("⌘⌫");
      expect(formatKeyForDisplay("Mod-Left")).toBe("⌘←");
      expect(formatKeyForDisplay("Mod-Right")).toBe("⌘→");
      expect(formatKeyForDisplay("Mod-Up")).toBe("⌘↑");
      expect(formatKeyForDisplay("Mod-Down")).toBe("⌘↓");
    });
  });
});
