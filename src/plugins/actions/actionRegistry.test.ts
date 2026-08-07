// @vitest-environment node
import { describe, it, expect } from "vitest";
import menuIds from "@shared/menu-ids.json";
import {
  MENU_TO_ACTION,
  getActionDefinition,
  getActionFromMenu,
  actionSupportsMode,
  getHeadingLevelFromParams,
  getMappedMenuEvents,
} from "./actionRegistry";

describe("actionRegistry", () => {
  it("maps all extracted menu IDs", () => {
    const mappedIds = new Set(
      Object.keys(MENU_TO_ACTION).map((key) => key.replace("menu:", ""))
    );

    const missing = menuIds.menuIds.filter((id) => !mappedIds.has(id));
    expect(missing).toEqual([]);
  });

  it("does not include extra menu mappings", () => {
    const mappedIds = new Set(
      Object.keys(MENU_TO_ACTION).map((key) => key.replace("menu:", ""))
    );
    const extras = [...mappedIds].filter((id) => !menuIds.menuIds.includes(id));
    expect(extras).toEqual([]);
  });

  describe("getActionDefinition", () => {
    it("returns definition for known action", () => {
      const def = getActionDefinition("bold");
      expect(def).toBeDefined();
      expect(def!.label).toBeDefined();
    });

    it("returns undefined for unknown action", () => {
      expect(getActionDefinition("nonexistent" as any)).toBeUndefined();
    });
  });

  describe("getActionFromMenu", () => {
    it("returns mapping for known menu event", () => {
      const events = getMappedMenuEvents();
      expect(events.length).toBeGreaterThan(0);
      const mapping = getActionFromMenu(events[0]);
      expect(mapping).toBeDefined();
    });

    it("returns undefined for unknown menu event", () => {
      expect(getActionFromMenu("menu:nonexistent" as any)).toBeUndefined();
    });
  });

  describe("actionSupportsMode", () => {
    it("returns true for bold in wysiwyg mode", () => {
      expect(actionSupportsMode("bold", "wysiwyg")).toBe(true);
    });

    it("returns false for unknown action", () => {
      expect(actionSupportsMode("nonexistent" as any, "wysiwyg")).toBe(false);
    });
  });

  describe("getHeadingLevelFromParams", () => {
    it("returns level from valid params", () => {
      expect(getHeadingLevelFromParams({ level: 3 })).toBe(3);
    });

    it("returns 1 for undefined params", () => {
      expect(getHeadingLevelFromParams()).toBe(1);
    });

    it("returns 1 for level out of range", () => {
      expect(getHeadingLevelFromParams({ level: 0 })).toBe(1);
      expect(getHeadingLevelFromParams({ level: 7 })).toBe(1);
    });

    it("returns 1 for non-number level", () => {
      expect(getHeadingLevelFromParams({ level: "two" })).toBe(1);
    });
  });

  describe("getMappedMenuEvents", () => {
    it("returns array of menu event strings", () => {
      const events = getMappedMenuEvents();
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toMatch(/^menu:/);
    });
  });
});
