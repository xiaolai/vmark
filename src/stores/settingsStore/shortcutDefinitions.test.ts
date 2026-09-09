// WI-TNAV0.3 — canonical duplicate-chord detection.
// WI-DSPL1.3 — the closePane / focusOtherPane chords, verified free under it.
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
import { canonicalizeChordString, type Platform } from "@/utils/keybinding/canonicalChord";

/** Effective default chord on Windows/Linux (`defaultKeyOther` wins). */
function otherPlatformKey(s: (typeof DEFAULT_SHORTCUTS)[number]): string {
  return s.defaultKeyOther ?? s.defaultKey;
}

function duplicates(
  pairs: { id: string; key: string }[],
  platform: Platform,
): string[] {
  const byKey = new Map<string, string[]>();
  for (const { id, key } of pairs) {
    if (!key) continue; // deliberately unbound — many, and they cannot collide
    // Key on the CANONICAL chord, never the raw string. `Alt-Mod-]` and
    // `Mod-Alt-]` are ONE accelerator written two ways, and `Mod` resolves to
    // ctrl off macOS, so `Mod-Shift-0` and `Ctrl-Shift-0` are one chord there.
    // A raw-string map counts each pair as two distinct keys and reports
    // nothing — while the native menu silently disables one of the two items.
    // An unparseable chord keys on itself, so a typo is still reported rather
    // than collapsing every bad chord into one bucket.
    const canonical = canonicalizeChordString(key, platform) ?? `unparsed:${key}`;
    byKey.set(canonical, [...(byKey.get(canonical) ?? []), id]);
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

  it("binds the Window Status panel on the 5th slot of the Ctrl+Shift+N panel series", () => {
    // Sidebar 0, Outline 1, File Explorer 2, History 3, Knowledge Base 4 — the
    // Window Status panel (#1057) had every wire but the key. Off macOS `Mod`
    // IS Ctrl, so this chord is Ctrl+Shift+5 on every platform and collides
    // with nothing; no `defaultKeyOther`, the same shape as slots 1–4. (Only
    // slot 0 needs one, because there Ctrl-Shift-0 would equal `paragraph`'s
    // Mod-Shift-0 off macOS.)
    const def = DEFAULT_SHORTCUTS.find((s) => s.id === "windowStatus");
    expect(def).toBeDefined();
    expect(def?.category).toBe("view");
    expect(def?.defaultKey).toBe("Ctrl-Shift-5");
    expect(def?.defaultKeyOther).toBeUndefined();
    expect(def?.menuId).toBe("window-status");
  });

  it("keeps the whole Ctrl+Shift+N panel series homogeneous", () => {
    // The reason this exists: the first version of the windowStatus binding
    // was correct on every gate and still wrong. It took slot 5 of a series
    // whose other members are View-menu panels, while its own menu item lived
    // in the macOS-only Window menu and was labelled "Window Status" rather
    // than "Toggle …". No gate could see that, because each surface agreed
    // with the surface it is checked against — the series itself was what had
    // become inconsistent.
    //
    // Slot 0 is excluded: Toggle Sidebar has no menu item at all, which is a
    // separate pre-existing gap and not what this pins.
    const series = DEFAULT_SHORTCUTS.filter((s) => /^Ctrl-Shift-[1-9]$/.test(s.defaultKey ?? ""));
    expect(series.length).toBeGreaterThanOrEqual(5);
    for (const s of series) {
      expect(s.category, `${s.id} is in the panel series but not the view category`).toBe("view");
      expect(s.label, `${s.id} is in the panel series but is not labelled "Toggle …"`).toMatch(
        /^Toggle /,
      );
      expect(s.menuId, `${s.id} is in the panel series but is not menu-backed`).toBeTruthy();
    }
    // Contiguous from 1, so a future addition takes the next slot rather than
    // leaving a hole that reads as a removed panel.
    expect(series.map((s) => s.defaultKey).sort()).toEqual(
      series.map((_, i) => `Ctrl-Shift-${i + 1}`),
    );
  });

  it("assigns each macOS default chord to at most one shortcut", () => {
    expect(
      duplicates(
        DEFAULT_SHORTCUTS.map((s) => ({ id: s.id, key: s.defaultKey })),
        "mac",
      ),
    ).toEqual([]);
  });

  it("assigns each Windows/Linux default chord to at most one shortcut", () => {
    expect(
      duplicates(
        DEFAULT_SHORTCUTS.map((s) => ({ id: s.id, key: otherPlatformKey(s) })),
        "other",
      ),
    ).toEqual([]);
  });

  // WI-TNAV0.3 — the detector's own guard. Before canonicalization it keyed a
  // Map on the raw string, so both cases below reported ZERO duplicates while
  // the native menu would silently disable one item of each pair.
  it("detects a duplicate chord written with a different modifier order", () => {
    expect(
      duplicates(
        [
          { id: "alpha", key: "Alt-Mod-]" },
          { id: "beta", key: "Mod-Alt-]" },
        ],
        "mac",
      ),
    ).toHaveLength(1);
  });

  it("detects Mod colliding with Ctrl off macOS, where Mod IS Ctrl", () => {
    const pairs = [
      { id: "alpha", key: "Mod-Shift-0" },
      { id: "beta", key: "Ctrl-Shift-0" },
    ];
    // Distinct on macOS (meta vs ctrl) …
    expect(duplicates(pairs, "mac")).toEqual([]);
    // … and one chord on Windows/Linux.
    expect(duplicates(pairs, "other")).toHaveLength(1);
  });
});
