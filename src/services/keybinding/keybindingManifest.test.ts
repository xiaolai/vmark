// WI-1.5 — keybinding manifest is the single source of truth for the
// cross-source-synced shortcut subset; the drift gate
// (scripts/check-keybinding-manifest.mjs) enforces it against
// shortcutDefinitions.ts, the REAL Rust menu builder (localized/*.rs accel(...)
// call sites, not just the contract mirror), and the website docs table
// (website/guide/shortcuts.md) — all four surfaces, fail-closed.

import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";
import { KEYBINDING_MANIFEST } from "./keybindingManifest";

/** Menu ids whose accelerator is registered dynamically, not via a static menu accel. */
const DYNAMIC_MENU_IDS = new Set(["search-genies"]);

describe("KEYBINDING_MANIFEST", () => {
  it("is non-empty", () => {
    expect(KEYBINDING_MANIFEST.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = KEYBINDING_MANIFEST.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique menuIds", () => {
    const menuIds = KEYBINDING_MANIFEST.map((e) => e.menuId);
    expect(new Set(menuIds).size).toBe(menuIds.length);
  });

  it("gives every entry a non-empty menuId", () => {
    for (const entry of KEYBINDING_MANIFEST) {
      expect(entry.menuId, `entry "${entry.id}" must have a menuId`).toBeTruthy();
    }
  });

  it("defines defaultKey as a string on every entry (may be empty for unbound)", () => {
    for (const entry of KEYBINDING_MANIFEST) {
      expect(typeof entry.defaultKey, `entry "${entry.id}"`).toBe("string");
    }
  });

  it("only carries defaultKeyOther when it differs from defaultKey", () => {
    for (const entry of KEYBINDING_MANIFEST) {
      if (entry.defaultKeyOther !== undefined) {
        expect(typeof entry.defaultKeyOther, `entry "${entry.id}"`).toBe("string");
      }
    }
  });
});

describe("KEYBINDING_MANIFEST vs DEFAULT_SHORTCUTS", () => {
  const shortcutById = new Map(DEFAULT_SHORTCUTS.map((s) => [s.id, s]));

  it("references only ids that exist in DEFAULT_SHORTCUTS", () => {
    for (const entry of KEYBINDING_MANIFEST) {
      expect(shortcutById.has(entry.id), `manifest id "${entry.id}" missing from DEFAULT_SHORTCUTS`).toBe(true);
    }
  });

  it("matches each shortcut's defaultKey, defaultKeyOther, and menuId", () => {
    for (const entry of KEYBINDING_MANIFEST) {
      const def = shortcutById.get(entry.id);
      expect(def).toBeDefined();
      expect(entry.defaultKey).toBe(def?.defaultKey ?? "");
      expect(entry.defaultKeyOther).toBe(def?.defaultKeyOther);
      expect(entry.menuId).toBe(def?.menuId);
    }
  });

  it("covers every DEFAULT_SHORTCUTS entry that has a menuId (minus dynamic ids)", () => {
    const manifestIds = new Set(KEYBINDING_MANIFEST.map((e) => e.id));
    for (const def of DEFAULT_SHORTCUTS) {
      if (!def.menuId) continue;
      if (DYNAMIC_MENU_IDS.has(def.menuId)) continue;
      expect(
        manifestIds.has(def.id),
        `"${def.id}" (${def.menuId}) has a menu accelerator but is absent from KEYBINDING_MANIFEST`,
      ).toBe(true);
    }
  });
});
