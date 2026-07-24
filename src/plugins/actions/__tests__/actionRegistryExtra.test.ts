/**
 * Action Registry Tests — extended coverage
 *
 * Tests for getActionDefinition, getActionFromMenu, actionSupportsMode,
 * getHeadingLevelFromParams, and getMappedMenuEvents.
 */

import { describe, it, expect } from "vitest";
import {
  getActionDefinition,
  getActionFromMenu,
  actionSupportsMode,
  getHeadingLevelFromParams,
  getMappedMenuEvents,
  MENU_TO_ACTION,
  ACTION_DEFINITIONS,
} from "../actionRegistry";
import type { ActionId } from "../types";

/* ================================================================== */
/*  getActionDefinition                                                */
/* ================================================================== */

describe("getActionDefinition", () => {
  it("returns definition for known action", () => {
    const def = getActionDefinition("bold");
    expect(def).toBeDefined();
    expect(def!.id).toBe("bold");
    expect(def!.label).toBe("Bold");
    expect(def!.category).toBe("formatting");
  });

  it("returns definition for undo", () => {
    const def = getActionDefinition("undo");
    expect(def).toBeDefined();
    expect(def!.supports.wysiwyg).toBe(true);
    expect(def!.supports.source).toBe(true);
  });

  it("returns undefined for unknown action", () => {
    const def = getActionDefinition("nonexistent" as ActionId);
    expect(def).toBeUndefined();
  });

  it("returns definition with defaultParams for setHeading", () => {
    const def = getActionDefinition("setHeading");
    expect(def).toBeDefined();
    expect(def!.defaultParams).toEqual({ level: 1 });
  });

  it("returns definition for every ACTION_IDS entry", () => {
    const ids = Object.keys(ACTION_DEFINITIONS);
    for (const id of ids) {
      const def = getActionDefinition(id as ActionId);
      expect(def).toBeDefined();
      expect(def!.id).toBe(id);
    }
  });
});

/* ================================================================== */
/*  getActionFromMenu                                                  */
/* ================================================================== */

describe("getActionFromMenu", () => {
  it("returns mapping for known menu event", () => {
    const mapping = getActionFromMenu("menu:bold");
    expect(mapping).toBeDefined();
    expect(mapping!.actionId).toBe("bold");
  });

  it("returns mapping with params for heading menu events", () => {
    const mapping = getActionFromMenu("menu:heading-1");
    expect(mapping).toBeDefined();
    expect(mapping!.actionId).toBe("setHeading");
    expect(mapping!.params).toEqual({ level: 1 });
  });

  it("returns undefined for unknown menu event", () => {
    const mapping = getActionFromMenu("menu:nonexistent");
    expect(mapping).toBeUndefined();
  });

  it("returns mapping for undo", () => {
    const mapping = getActionFromMenu("menu:undo");
    expect(mapping).toBeDefined();
    expect(mapping!.actionId).toBe("undo");
  });

  it("returns mapping for redo", () => {
    const mapping = getActionFromMenu("menu:redo");
    expect(mapping).toBeDefined();
    expect(mapping!.actionId).toBe("redo");
  });
});

/* ================================================================== */
/*  actionSupportsMode                                                 */
/* ================================================================== */

describe("actionSupportsMode", () => {
  it("returns true for bold in wysiwyg", () => {
    expect(actionSupportsMode("bold", "wysiwyg")).toBe(true);
  });

  it("returns true for bold in source", () => {
    expect(actionSupportsMode("bold", "source")).toBe(true);
  });

  it("returns false for sortLinesAsc in wysiwyg", () => {
    expect(actionSupportsMode("sortLinesAsc", "wysiwyg")).toBe(false);
  });

  it("returns true for sortLinesAsc in source", () => {
    expect(actionSupportsMode("sortLinesAsc", "source")).toBe(true);
  });

  it("returns false for toggleQuoteStyle in source", () => {
    expect(actionSupportsMode("toggleQuoteStyle", "source")).toBe(false);
  });

  it("returns true for toggleQuoteStyle in wysiwyg", () => {
    expect(actionSupportsMode("toggleQuoteStyle", "wysiwyg")).toBe(true);
  });

  it("returns false for unknown action", () => {
    expect(actionSupportsMode("nonexistent" as ActionId, "wysiwyg")).toBe(false);
    expect(actionSupportsMode("nonexistent" as ActionId, "source")).toBe(false);
  });
});

/* ================================================================== */
/*  getHeadingLevelFromParams                                          */
/* ================================================================== */

describe("getHeadingLevelFromParams", () => {
  it("returns level from params", () => {
    expect(getHeadingLevelFromParams({ level: 1 })).toBe(1);
    expect(getHeadingLevelFromParams({ level: 2 })).toBe(2);
    expect(getHeadingLevelFromParams({ level: 3 })).toBe(3);
    expect(getHeadingLevelFromParams({ level: 4 })).toBe(4);
    expect(getHeadingLevelFromParams({ level: 5 })).toBe(5);
    expect(getHeadingLevelFromParams({ level: 6 })).toBe(6);
  });

  it("returns 1 as default when params is undefined", () => {
    expect(getHeadingLevelFromParams()).toBe(1);
    expect(getHeadingLevelFromParams(undefined)).toBe(1);
  });

  it("returns 1 when level is not in params", () => {
    expect(getHeadingLevelFromParams({})).toBe(1);
  });

  it("returns 1 for level 0 (out of range)", () => {
    expect(getHeadingLevelFromParams({ level: 0 })).toBe(1);
  });

  it("returns 1 for level 7 (out of range)", () => {
    expect(getHeadingLevelFromParams({ level: 7 })).toBe(1);
  });

  it("returns 1 for negative level", () => {
    expect(getHeadingLevelFromParams({ level: -1 })).toBe(1);
  });

  it("returns 1 for string level", () => {
    expect(getHeadingLevelFromParams({ level: "2" })).toBe(1);
  });

  it("returns 1 for a fractional level within range (audit-fix #4)", () => {
    // 2.5 is between 1 and 6 but not a whole heading level — reject it rather than
    // casting a fractional value into HeadingLevel, which would produce a malformed
    // heading in the setters.
    expect(getHeadingLevelFromParams({ level: 2.5 })).toBe(1);
    expect(getHeadingLevelFromParams({ level: 1.0001 })).toBe(1);
  });

  it("returns 1 for null level", () => {
    expect(getHeadingLevelFromParams({ level: null })).toBe(1);
  });
});

/* ================================================================== */
/*  getMappedMenuEvents                                                */
/* ================================================================== */

describe("getMappedMenuEvents", () => {
  it("returns an array of menu event IDs", () => {
    const events = getMappedMenuEvents();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it("all events start with menu:", () => {
    const events = getMappedMenuEvents();
    for (const event of events) {
      expect(event).toMatch(/^menu:/);
    }
  });

  it("contains expected events", () => {
    const events = getMappedMenuEvents();
    expect(events).toContain("menu:bold");
    expect(events).toContain("menu:undo");
    expect(events).toContain("menu:redo");
  });

  it("has same length as MENU_TO_ACTION keys", () => {
    const events = getMappedMenuEvents();
    expect(events.length).toBe(Object.keys(MENU_TO_ACTION).length);
  });
});

/* ================================================================== */
/*  Structural integrity                                               */
/* ================================================================== */

describe("structural integrity", () => {
  it("every MENU_TO_ACTION entry references a valid ActionId", () => {
    for (const [menuId, mapping] of Object.entries(MENU_TO_ACTION)) {
      const def = ACTION_DEFINITIONS[mapping.actionId as ActionId];
      expect(def, `menu ${menuId} maps to unknown action ${mapping.actionId}`).toBeDefined();
    }
  });

  it("every action definition has required fields", () => {
    for (const [id, def] of Object.entries(ACTION_DEFINITIONS)) {
      expect(def.id, `${id} missing id`).toBe(id);
      expect(typeof def.label, `${id} missing label`).toBe("string");
      expect(typeof def.category, `${id} missing category`).toBe("string");
      expect(typeof def.supports.wysiwyg, `${id} missing wysiwyg`).toBe("boolean");
      expect(typeof def.supports.source, `${id} missing source`).toBe("boolean");
    }
  });
});
