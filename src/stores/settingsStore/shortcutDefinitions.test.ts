/**
 * Default shortcut table invariants.
 *
 * Guards the class of bug behind issue #1224: "Toggle All Files" was fully
 * wired (command, keybinding, ten locales, docs row) but shipped with an
 * EMPTY default key, so the only escape from "this folder looks empty" was a
 * settings page the user had no reason to visit. A binding nothing can press
 * is indistinguishable from a missing feature.
 *
 * Uniqueness is asserted per platform map because `defaultKeyOther` overrides
 * `defaultKey` on Windows/Linux — two shortcuts can be distinct on macOS and
 * collide there.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS } from "./shortcutDefinitions";

/** Effective default chord on Windows/Linux (`defaultKeyOther` wins). */
function otherPlatformKey(s: (typeof DEFAULT_SHORTCUTS)[number]): string {
  return s.defaultKeyOther ?? s.defaultKey;
}

function duplicates(pairs: { id: string; key: string }[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const { id, key } of pairs) {
    if (!key) continue; // deliberately unbound — many, and they cannot collide
    byKey.set(key, [...(byKey.get(key) ?? []), id]);
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => `${key}: ${ids.join(", ")}`);
}

describe("DEFAULT_SHORTCUTS", () => {
  it("binds the two file-explorer visibility toggles out of the box", () => {
    const byId = new Map(DEFAULT_SHORTCUTS.map((s) => [s.id, s]));

    // Finder's own chord — kept, and the reason Toggle All Files cannot have it.
    expect(byId.get("toggleHiddenFiles")?.defaultKey).toBe("Mod-Shift-.");
    expect(byId.get("toggleAllFiles")?.defaultKey).toBe("Mod-Shift-a");
  });

  it("assigns each macOS default chord to at most one shortcut", () => {
    expect(
      duplicates(DEFAULT_SHORTCUTS.map((s) => ({ id: s.id, key: s.defaultKey }))),
    ).toEqual([]);
  });

  it("assigns each Windows/Linux default chord to at most one shortcut", () => {
    expect(
      duplicates(
        DEFAULT_SHORTCUTS.map((s) => ({ id: s.id, key: otherPlatformKey(s) })),
      ),
    ).toEqual([]);
  });
});
