// @vitest-environment node
/**
 * Toolbar Groups - Tests
 *
 * TDD tests for button group definitions (WI-002).
 */
import { describe, it, expect } from "vitest";
import { TOOLBAR_GROUPS, isSeparator } from "./toolbarGroups";

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
        "link",
        "insert",
      ]);
    });

    it("each group has required properties", () => {
      for (const group of TOOLBAR_GROUPS) {
        expect(group.id).toBeDefined();
        expect(group.label).toBeDefined();
        expect(Array.isArray(group.items)).toBe(true);
        expect(group.items.length).toBeGreaterThan(0);
      }
    });

    it("each action item has required properties", () => {
      for (const group of TOOLBAR_GROUPS) {
        for (const item of group.items) {
          expect(item.id).toBeDefined();
          // Separators only need an id
          if (isSeparator(item)) continue;
          expect(item.icon).toBeDefined();
          expect(item.label).toBeDefined();
          expect(item.action).toBeDefined();
        }
      }
    });
  });

  describe("block group", () => {
    it("contains heading items", () => {
      const block = TOOLBAR_GROUPS.find((g) => g.id === "block");
      expect(block).toBeDefined();
      const headingItems = block!.items.map((item) => item.id);
      expect(headingItems).toContain("paragraph");
      expect(headingItems).toContain("h1");
    });
  });

  describe("inline group", () => {
    it("contains all format items", () => {
      const inline = TOOLBAR_GROUPS.find((g) => g.id === "inline");
      expect(inline).toBeDefined();

      const itemIds = inline!.items.map((item) => item.id);

      expect(itemIds).toContain("bold");
      expect(itemIds).toContain("italic");
      expect(itemIds).toContain("underline");
      expect(itemIds).toContain("strikethrough");
      expect(itemIds).toContain("highlight");
      expect(itemIds).toContain("superscript");
      expect(itemIds).toContain("subscript");
      expect(itemIds).toContain("code");
      expect(itemIds).toContain("clear-formatting");
    });
  });

  describe("list group", () => {
    it("contains bullet, ordered, task, indent, outdent, remove", () => {
      const list = TOOLBAR_GROUPS.find((g) => g.id === "list");
      expect(list).toBeDefined();

      const itemIds = list!.items.map((item) => item.id);

      expect(itemIds).toContain("bullet-list");
      expect(itemIds).toContain("ordered-list");
      expect(itemIds).toContain("task-list");
      expect(itemIds).toContain("indent");
      expect(itemIds).toContain("outdent");
      expect(itemIds).toContain("remove-list");
    });
  });

  describe("table group", () => {
    it("contains table operations", () => {
      const table = TOOLBAR_GROUPS.find((g) => g.id === "table");
      expect(table).toBeDefined();

      const itemIds = table!.items.map((item) => item.id);

      expect(itemIds).toContain("insert-table");
      expect(itemIds).toContain("add-row");
      expect(itemIds).toContain("add-col");
    });
  });

  describe("button enabled state", () => {
    it("action items have enabledIn property for context", () => {
      // All action items should have enabledIn to define when they're active
      for (const group of TOOLBAR_GROUPS) {
        for (const item of group.items) {
          // Separators don't have enabledIn
          if (isSeparator(item)) continue;
          expect(item.enabledIn).toBeDefined();
        }
      }
    });
  });

  describe("insert group alert items", () => {
    it("contains 5 alert type items (merged from expandables)", () => {
      const insert = TOOLBAR_GROUPS.find((g) => g.id === "insert");
      expect(insert).toBeDefined();

      const itemIds = insert!.items.map((item) => item.id);
      const actionItems = insert!.items.filter((item) => !isSeparator(item));
      const itemActions = actionItems.map((item) => !isSeparator(item) ? item.action : "");

      // Should NOT have single insertAlert
      expect(itemActions).not.toContain("insertAlert");

      // Should have 5 specific alert types
      expect(itemIds).toContain("insert-alert-note");
      expect(itemIds).toContain("insert-alert-tip");
      expect(itemIds).toContain("insert-alert-important");
      expect(itemIds).toContain("insert-alert-warning");
      expect(itemIds).toContain("insert-alert-caution");

      // Verify actions match
      expect(itemActions).toContain("insertAlertNote");
      expect(itemActions).toContain("insertAlertTip");
      expect(itemActions).toContain("insertAlertImportant");
      expect(itemActions).toContain("insertAlertWarning");
      expect(itemActions).toContain("insertAlertCaution");
    });

    it("alert items are enabled in textblock context", () => {
      const insert = TOOLBAR_GROUPS.find((g) => g.id === "insert");
      const alertItems = insert!.items.filter((item) =>
        item.id.startsWith("insert-alert-")
      );

      expect(alertItems.length).toBe(5);
      for (const item of alertItems) {
        if (isSeparator(item)) continue;
        expect(item.enabledIn).toContain("textblock");
      }
    });
  });
});
