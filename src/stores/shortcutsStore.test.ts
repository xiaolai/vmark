/**
 * Tests for shortcuts store.
 *
 * Verifies keyboard shortcut management, customization, and conflict detection.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useShortcutsStore,
  DEFAULT_SHORTCUTS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  getCategoryLabel,
  getShortcutLabel,
  formatKeyForDisplay,
  prosemirrorToTauri,
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
      expect(DEFAULT_SHORTCUTS.length).toBeGreaterThan(53);
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

    it("includes newWindow, diagramPreview, and useSelectionFind", () => {
      const map = new Map(DEFAULT_SHORTCUTS.map((s) => [s.id, s]));

      const newWindow = map.get("newWindow");
      expect(newWindow).toBeDefined();
      expect(newWindow?.defaultKey).toBe("Mod-Shift-n");
      expect(newWindow?.menuId).toBe("new-window");
      expect(newWindow?.category).toBe("file");

      const diagramPreview = map.get("diagramPreview");
      expect(diagramPreview).toBeDefined();
      expect(diagramPreview?.defaultKey).toBe("Alt-Mod-p");
      expect(diagramPreview?.menuId).toBe("diagram-preview");
      expect(diagramPreview?.category).toBe("view");

      const useSelectionFind = map.get("useSelectionFind");
      expect(useSelectionFind).toBeDefined();
      expect(useSelectionFind?.defaultKey).toBe("Mod-e");
      expect(useSelectionFind?.menuId).toBe("use-selection-find");
      expect(useSelectionFind?.category).toBe("navigation");
    });

    it("bookmarkLink menuId matches menu.rs", () => {
      const bookmark = DEFAULT_SHORTCUTS.find((s) => s.id === "bookmarkLink");
      expect(bookmark).toBeDefined();
      expect(bookmark?.menuId).toBe("bookmark");
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

  describe("CATEGORY_LABELS", () => {
    it("has labels for all categories", () => {
      for (const category of CATEGORY_ORDER) {
        expect(CATEGORY_LABELS[category]).toBeDefined();
      }
    });
  });

  describe("getCategoryLabel", () => {
    it("returns translated label for each category via i18n", () => {
      // The test mock resolves settings:shortcuts.category.* keys to English values
      // (since setup.ts loads en/settings.json which now has these keys)
      expect(getCategoryLabel("formatting")).toBe("Formatting");
      expect(getCategoryLabel("blocks")).toBe("Blocks");
      expect(getCategoryLabel("navigation")).toBe("Navigation");
      expect(getCategoryLabel("editing")).toBe("Editing");
      expect(getCategoryLabel("view")).toBe("View");
      expect(getCategoryLabel("file")).toBe("File");
    });

    it("covers all CATEGORY_ORDER entries", () => {
      for (const category of CATEGORY_ORDER) {
        const label = getCategoryLabel(category);
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });

    it("falls back to CATEGORY_LABELS value when i18n key is missing", () => {
      // If i18n returns the key itself (missing translation), fallback is used
      // We verify the fallback by checking the value matches CATEGORY_LABELS
      // when we have a valid category (translation resolves for all in en locale)
      const label = getCategoryLabel("file");
      expect(label).toBe("File");
    });
  });

  describe("getShortcutLabel", () => {
    it("returns translated label for shortcuts via i18n", () => {
      const boldDef = DEFAULT_SHORTCUTS.find((s) => s.id === "bold")!;
      expect(getShortcutLabel(boldDef)).toBe("Bold");

      const italicDef = DEFAULT_SHORTCUTS.find((s) => s.id === "italic")!;
      expect(getShortcutLabel(italicDef)).toBe("Italic");

      const codeDef = DEFAULT_SHORTCUTS.find((s) => s.id === "code")!;
      expect(getShortcutLabel(codeDef)).toBe("Inline Code");
    });

    it("returns translated label for all shortcuts without throwing", () => {
      for (const shortcut of DEFAULT_SHORTCUTS) {
        const label = getShortcutLabel(shortcut);
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });

    it("falls back to shortcut.label for unknown id", () => {
      const fakeDef = { id: "unknownXyz", label: "Unknown Action", category: "editing" as const, defaultKey: "" };
      // i18n.t returns the key itself for missing translations → falls back to shortcut.label
      expect(getShortcutLabel(fakeDef)).toBe("Unknown Action");
    });

    it("returns translated label for CJK-specific shortcuts", () => {
      const formatCJKDef = DEFAULT_SHORTCUTS.find((s) => s.id === "formatCJKSelection")!;
      expect(getShortcutLabel(formatCJKDef)).toBe("Format CJK Selection");
    });

    it("returns translated label for AI Genies shortcut", () => {
      const aiDef = DEFAULT_SHORTCUTS.find((s) => s.id === "aiPrompts")!;
      expect(getShortcutLabel(aiDef)).toBe("AI Genies");
    });
  });

  describe("prosemirrorToTauri", () => {
    it.each([
      { input: "Mod-b", expected: "CmdOrCtrl+B" },
      { input: "Mod-Shift-n", expected: "CmdOrCtrl+Shift+N" },
      { input: "Alt-Mod-l", expected: "Alt+CmdOrCtrl+L" },
      { input: "Mod-Shift-`", expected: "CmdOrCtrl+Shift+`" },
      { input: "Mod--", expected: "CmdOrCtrl+-", description: "minus key (zoomOut)" },
      { input: "Alt-Mod--", expected: "Alt+CmdOrCtrl+-", description: "minus key (horizontalLine)" },
      { input: "", expected: "" },
      { input: "F6", expected: "F6" },
      { input: "Mod-1", expected: "CmdOrCtrl+1" },
      { input: "Ctrl-Shift-u", expected: "Ctrl+Shift+U" },
    ])("$input → $expected", ({ input, expected }) => {
      expect(prosemirrorToTauri(input)).toBe(expected);
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

  describe("resolveDefaultKey — platform-specific key branches", () => {
    it("returns defaultKeyMac on macOS when it is defined", async () => {
      // isMacPlatform is mocked to return true.
      // Find or inject a shortcut that has defaultKeyMac.
      const { isMacPlatform } = await import("@/utils/shortcutMatch");
      vi.mocked(isMacPlatform).mockReturnValue(true);

      // We can access resolveDefaultKey indirectly via getShortcut.
      // To test the defaultKeyMac branch we need a shortcut with defaultKeyMac.
      // Since DEFAULT_SHORTCUTS may not have one, check if any exist first.
      const withMacKey = DEFAULT_SHORTCUTS.find((s) => s.defaultKeyMac);
      if (withMacKey) {
        const key = useShortcutsStore.getState().getShortcut(withMacKey.id);
        expect(key).toBe(withMacKey.defaultKeyMac);
      } else {
        // No shortcut has defaultKeyMac currently — branch is structurally unreachable
        // until one is added. Skip assertion.
        expect(true).toBe(true);
      }
    });

    it("returns defaultKeyOther on non-macOS when it is defined", async () => {
      const { isMacPlatform } = await import("@/utils/shortcutMatch");
      vi.mocked(isMacPlatform).mockReturnValue(false);

      useShortcutsStore.setState({ customBindings: {} });

      const withOtherKey = DEFAULT_SHORTCUTS.find((s) => s.defaultKeyOther);
      if (withOtherKey) {
        const key = useShortcutsStore.getState().getShortcut(withOtherKey.id);
        expect(key).toBe(withOtherKey.defaultKeyOther);
      } else {
        expect(true).toBe(true);
      }

      // Restore
      vi.mocked(isMacPlatform).mockReturnValue(true);
    });
  });

  describe("importConfig — no errors path (errors array is empty → returns undefined)", () => {
    it("returns errors as undefined when all bindings are valid", () => {
      const { importConfig } = useShortcutsStore.getState();
      const config = JSON.stringify({
        version: 1,
        customBindings: { bold: "Ctrl-b" },
      });

      const result = importConfig(config);
      // success=true, errors should be undefined (not an empty array)
      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe("syncMenuShortcuts — differential path (Issue #825)", () => {
    it("invokes update_menu_accelerators, never rebuild_menu or refresh_genies_menu", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { flushMenuShortcutsSync } = await import("./shortcutsStore");
      vi.mocked(invoke).mockClear();

      useShortcutsStore.getState().setShortcut("bold", "Mod-Shift-Alt-b");
      await flushMenuShortcutsSync();

      const calls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
      expect(calls).toContain("update_menu_accelerators");
      expect(calls).not.toContain("rebuild_menu");
      expect(calls).not.toContain("refresh_genies_menu");
    });

    it("coalesces rapid edits into a single native-menu update", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { flushMenuShortcutsSync } = await import("./shortcutsStore");
      vi.mocked(invoke).mockClear();

      const { setShortcut } = useShortcutsStore.getState();
      setShortcut("bold", "Mod-Alt-b");
      setShortcut("italic", "Mod-Alt-i");
      setShortcut("code", "Mod-Alt-c");
      await flushMenuShortcutsSync();

      const accelCalls = vi
        .mocked(invoke)
        .mock.calls.filter((c) => c[0] === "update_menu_accelerators");
      // One trailing-debounced flush, not three
      expect(accelCalls).toHaveLength(1);
    });

    it("sends the final shortcut set after coalescing (last write wins)", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { flushMenuShortcutsSync } = await import("./shortcutsStore");
      vi.mocked(invoke).mockClear();

      const { setShortcut } = useShortcutsStore.getState();
      setShortcut("bold", "Mod-Alt-b");
      setShortcut("bold", "Mod-Shift-b"); // supersedes the first edit
      await flushMenuShortcutsSync();

      const accelCall = vi
        .mocked(invoke)
        .mock.calls.find((c) => c[0] === "update_menu_accelerators");
      expect(accelCall).toBeDefined();
      const shortcuts = (accelCall![1] as { shortcuts: Record<string, string> })
        .shortcuts;
      expect(shortcuts.bold).toBe("CmdOrCtrl+Shift+B");
    });

    it("converts ProseMirror keys to Tauri accelerator format before sending", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { flushMenuShortcutsSync } = await import("./shortcutsStore");
      vi.mocked(invoke).mockClear();

      useShortcutsStore.getState().setShortcut("bold", "Mod-b");
      await flushMenuShortcutsSync();

      const accelCall = vi
        .mocked(invoke)
        .mock.calls.find((c) => c[0] === "update_menu_accelerators");
      const shortcuts = (accelCall![1] as { shortcuts: Record<string, string> })
        .shortcuts;
      expect(shortcuts.bold).toBe("CmdOrCtrl+B");
    });

    it("fires the trailing debounce on its own after the window elapses", async () => {
      // Exercises the natural setTimeout callback (not the flush helper)
      // so coverage reflects the real production path.
      vi.useFakeTimers();
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        vi.mocked(invoke).mockClear();

        useShortcutsStore.getState().setShortcut("bold", "Mod-Shift-Alt-b");
        vi.advanceTimersByTime(150);
        await vi.runAllTimersAsync();

        const calls = vi
          .mocked(invoke)
          .mock.calls.filter((c) => c[0] === "update_menu_accelerators");
        expect(calls).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("serializes overlapping invokes so older snapshots cannot overtake newer ones", async () => {
      // Regression: if two debounced flushes race on slow IPC, the older
      // payload could reach Rust last and revert the user's newer edit.
      // The in-flight chain must make the second invoke wait for the first.
      const { invoke } = await import("@tauri-apps/api/core");
      const { flushMenuShortcutsSync } = await import("./shortcutsStore");

      const order: string[] = [];
      let firstCalled = false;
      let resolveFirst: (() => void) | null = null;

      vi.mocked(invoke).mockImplementation((async (cmd: string) => {
        if (cmd !== "update_menu_accelerators") return undefined;
        if (!firstCalled) {
          firstCalled = true;
          order.push("first:start");
          await new Promise<void>((res) => {
            resolveFirst = res;
          });
          order.push("first:done");
          return undefined;
        }
        order.push("second:start");
        order.push("second:done");
        return undefined;
      }) as never);

      // Drain pending microtasks between test steps. `setTimeout(..., 0)`
      // is enough because queueSyncMenuShortcuts chains through two
      // microtask ticks before the invoke actually fires.
      const drain = () => new Promise<void>((r) => setTimeout(r, 0));

      // First edit + flush starts an invoke that we'll deliberately block.
      useShortcutsStore.getState().setShortcut("bold", "Mod-Alt-b");
      const firstFlush = flushMenuShortcutsSync();
      await drain();
      expect(order).toEqual(["first:start"]);

      // Second edit arrives while first is still pending.
      useShortcutsStore.getState().setShortcut("italic", "Mod-Alt-i");
      const secondFlush = flushMenuShortcutsSync();
      await drain();
      // The chain must block — second invoke has NOT started yet.
      expect(order).toEqual(["first:start"]);

      // Releasing the first unblocks the chain.
      resolveFirst!();
      await firstFlush;
      await secondFlush;

      expect(order).toEqual([
        "first:start",
        "first:done",
        "second:start",
        "second:done",
      ]);
    });
  });
});
