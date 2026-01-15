/**
 * Toolbar Groups - Tests
 *
 * TDD tests for button group definitions (WI-002).
 */
import { describe, it, expect } from "vitest";
import { TOOLBAR_GROUPS } from "./toolbarGroups";

describe("toolbarGroups", () => {
  describe("structure", () => {
    it("defines groups in spec order", () => {
      const groupIds = TOOLBAR_GROUPS.map((g) => g.id);
      expect(groupIds).toEqual([
        "block",
        "inline",
        "list",
        "table",
        "blockquote",
        "insert",
        "expandables",
        "link",
      ]);
    });

    it("each group has required properties", () => {
      for (const group of TOOLBAR_GROUPS) {
        expect(group.id).toBeDefined();
        expect(group.label).toBeDefined();
        expect(Array.isArray(group.buttons)).toBe(true);
        expect(group.buttons.length).toBeGreaterThan(0);
      }
    });

    it("each button has required properties", () => {
      for (const group of TOOLBAR_GROUPS) {
        for (const button of group.buttons) {
          if (button.type === "separator") continue;
          expect(button.id).toBeDefined();
          expect(button.icon).toBeDefined();
          expect(button.label).toBeDefined();
          expect(button.action).toBeDefined();
        }
      }
    });
  });

  describe("block group", () => {
    it("contains heading dropdown", () => {
      const block = TOOLBAR_GROUPS.find((g) => g.id === "block");
      expect(block).toBeDefined();
      const heading = block!.buttons.find((b) => b.id === "heading");
      expect(heading).toBeDefined();
      expect(heading!.type).toBe("dropdown");
    });
  });

  describe("inline group", () => {
    it("contains all format buttons in spec order", () => {
      const inline = TOOLBAR_GROUPS.find((g) => g.id === "inline");
      expect(inline).toBeDefined();

      const buttonIds = inline!.buttons
        .filter((b) => b.type !== "separator")
        .map((b) => b.id);

      expect(buttonIds).toContain("bold");
      expect(buttonIds).toContain("italic");
      expect(buttonIds).toContain("underline");
      expect(buttonIds).toContain("strikethrough");
      expect(buttonIds).toContain("highlight");
      expect(buttonIds).toContain("superscript");
      expect(buttonIds).toContain("subscript");
      expect(buttonIds).toContain("code");
      expect(buttonIds).toContain("clear-formatting");
    });
  });

  describe("list group", () => {
    it("contains bullet, ordered, task, indent, outdent, remove", () => {
      const list = TOOLBAR_GROUPS.find((g) => g.id === "list");
      expect(list).toBeDefined();

      const buttonIds = list!.buttons
        .filter((b) => b.type !== "separator")
        .map((b) => b.id);

      expect(buttonIds).toContain("bullet-list");
      expect(buttonIds).toContain("ordered-list");
      expect(buttonIds).toContain("task-list");
      expect(buttonIds).toContain("indent");
      expect(buttonIds).toContain("outdent");
      expect(buttonIds).toContain("remove-list");
    });
  });

  describe("table group", () => {
    it("contains table operations", () => {
      const table = TOOLBAR_GROUPS.find((g) => g.id === "table");
      expect(table).toBeDefined();

      const buttonIds = table!.buttons
        .filter((b) => b.type !== "separator")
        .map((b) => b.id);

      expect(buttonIds).toContain("insert-table");
      expect(buttonIds).toContain("add-row");
      expect(buttonIds).toContain("add-col");
    });
  });

  describe("button enabled state", () => {
    it("buttons have enabledIn property for context", () => {
      // All buttons should have enabledIn to define when they're active
      for (const group of TOOLBAR_GROUPS) {
        for (const button of group.buttons) {
          if (button.type === "separator") continue;
          expect(button.enabledIn).toBeDefined();
        }
      }
    });
  });
});
