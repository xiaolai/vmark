/**
 * Unit tests for open file command logic
 *
 * Tests the pure decision logic for opening files in tabs,
 * without invoking Tauri APIs or store side effects.
 */
import { describe, it, expect } from "vitest";
import {
  shouldOpenInNewTab,
  resolveOpenTarget,
  type OpenFileContext,
} from "./openFileCommand";

describe("openFileCommand", () => {
  describe("shouldOpenInNewTab", () => {
    it("returns true by default (workspace-first design)", () => {
      expect(shouldOpenInNewTab({})).toBe(true);
    });

    it("returns false when reuseExistingTab is true and tab exists", () => {
      expect(
        shouldOpenInNewTab({
          reuseExistingTab: true,
          existingTabId: "tab-123",
        })
      ).toBe(false);
    });

    it("returns true when reuseExistingTab is true but no existing tab", () => {
      expect(
        shouldOpenInNewTab({
          reuseExistingTab: true,
          existingTabId: null,
        })
      ).toBe(true);
    });
  });

  describe("resolveOpenTarget", () => {
    const baseContext: OpenFileContext = {
      filePath: "/path/to/file.md",
      windowLabel: "main",
      existingTabId: null,
    };

    it("returns create_tab when file should open in new tab", () => {
      const result = resolveOpenTarget(baseContext);
      expect(result.action).toBe("create_tab");
      if (result.action === "create_tab") {
        expect(result.filePath).toBe("/path/to/file.md");
      }
    });

    it("returns activate_tab when existing tab found", () => {
      const result = resolveOpenTarget({
        ...baseContext,
        existingTabId: "tab-123",
        reuseExistingTab: true,
      });
      expect(result.action).toBe("activate_tab");
      if (result.action === "activate_tab") {
        expect(result.tabId).toBe("tab-123");
      }
    });

    it("returns no_op when file path is empty", () => {
      const result = resolveOpenTarget({
        ...baseContext,
        filePath: "",
      });
      expect(result.action).toBe("no_op");
      if (result.action === "no_op") {
        expect(result.reason).toBe("empty_path");
      }
    });

    it("creates new tab when no existing tab", () => {
      const result = resolveOpenTarget({
        ...baseContext,
        existingTabId: null,
      });
      expect(result.action).toBe("create_tab");
    });

    it("creates new tab when not reusing existing", () => {
      const result = resolveOpenTarget({
        ...baseContext,
        existingTabId: "tab-123",
        reuseExistingTab: false,
      });
      expect(result.action).toBe("create_tab");
    });
  });
});
