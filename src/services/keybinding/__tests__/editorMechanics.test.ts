// @vitest-environment node
/**
 * WI-4.1 — editor-mechanic classification gate. Asserts the approved-mechanic
 * allowlist stays disjoint from the REAL registered commands and the shortcut /
 * menu id sets, so a configurable command can never masquerade as a mechanic.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  APPROVED_MECHANICS,
  APPROVED_MECHANIC_IDS,
  validateMechanicClassification,
} from "./editorMechanics";
import { listCommands, _resetCommandBus } from "@/services/commands/CommandBus";
import { registerEditorCommands } from "@/services/commands/editorCommandBridge";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";

const shortcutIds = new Set(DEFAULT_SHORTCUTS.map((s) => s.id));
const menuIds = new Set(
  DEFAULT_SHORTCUTS.map((s) => s.menuId).filter((m): m is string => !!m),
);

function currentCommandIds(): Set<string> {
  return new Set(listCommands().map((c) => c.id));
}

beforeEach(() => {
  _resetCommandBus();
});

describe("APPROVED_MECHANICS — well-formed", () => {
  it("every mechanic has a namespaced id, at least one key, and a rationale", () => {
    for (const m of APPROVED_MECHANICS) {
      expect(m.id, `mechanic id "${m.id}"`).toMatch(/^(source|wysiwyg|both)\.[a-zA-Z]/);
      expect(m.keys.length, `mechanic "${m.id}" keys`).toBeGreaterThan(0);
      expect(m.rationale.trim(), `mechanic "${m.id}" rationale`).not.toBe("");
    }
  });

  it("has no duplicate ids", () => {
    expect(APPROVED_MECHANIC_IDS.size).toBe(APPROVED_MECHANICS.length);
  });
});

describe("validateMechanicClassification — against the real registries", () => {
  it("passes: no mechanic collides with a command, shortcut, or menu id", () => {
    // Register the full editor.* command surface so the gate sees the real set.
    registerEditorCommands();
    const violations = validateMechanicClassification({
      commandIds: currentCommandIds(),
      shortcutIds,
      menuIds,
    });
    expect(violations).toEqual([]);
  });

  it("no mechanic id appears in the configurable shortcut set", () => {
    for (const m of APPROVED_MECHANICS) {
      expect(shortcutIds.has(m.id), `mechanic "${m.id}" is also a shortcut`).toBe(false);
    }
  });

  it("no mechanic id appears in the menu id set", () => {
    for (const m of APPROVED_MECHANICS) {
      expect(menuIds.has(m.id), `mechanic "${m.id}" is also a menu id`).toBe(false);
    }
  });

  it("no mechanic id collides with a registered editor.* command", () => {
    registerEditorCommands();
    const commandIds = currentCommandIds();
    for (const m of APPROVED_MECHANICS) {
      expect(commandIds.has(m.id), `mechanic "${m.id}" is also a command`).toBe(false);
    }
  });
});

describe("validateMechanicClassification — catches misclassification", () => {
  it("rejects a mechanic id that collides with a command", () => {
    const violations = validateMechanicClassification({
      commandIds: new Set(["both.smartSelectAll"]),
      shortcutIds: new Set(),
      menuIds: new Set(),
    });
    expect(violations.some((v) => v.includes("both.smartSelectAll"))).toBe(true);
  });

  it("rejects a mechanic id that is also a configurable shortcut", () => {
    const violations = validateMechanicClassification({
      commandIds: new Set(),
      shortcutIds: new Set(["wysiwyg.escape"]),
      menuIds: new Set(),
    });
    expect(violations.some((v) => v.includes("wysiwyg.escape"))).toBe(true);
  });

  it("rejects a mechanic id that is also a menu id", () => {
    const violations = validateMechanicClassification({
      commandIds: new Set(),
      shortcutIds: new Set(),
      menuIds: new Set(["source.autoPair"]),
    });
    expect(violations.some((v) => v.includes("source.autoPair"))).toBe(true);
  });
});
