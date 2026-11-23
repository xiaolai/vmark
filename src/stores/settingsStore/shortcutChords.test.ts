// @vitest-environment node
/**
 * Chord identity, fixed accelerators and the bindings boundary — and the drift
 * guard that keeps `FIXED_ACCELERATORS` equal to the Rust menu builder's
 * `FIXED_ACCELERATOR_IDS` (#1722).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  FIXED_ACCELERATORS,
  chordIdentity,
  isFixedAccelerator,
  reconcileCustomBindings,
} from "./shortcutChords";
import { DEFAULT_SHORTCUTS } from "./shortcutDefinitions";
import { prosemirrorToTauri } from "./keyFormatting";

const ROOT = join(import.meta.dirname, "../../..");
const MENU_DIR = join(ROOT, "src-tauri/src/menu");

describe("chordIdentity", () => {
  it.each([
    ["Mod-Shift-Up", "Ctrl-Shift-Up", "other", true],
    ["Mod-Shift-Up", "Ctrl-Shift-Up", "mac", false],
    ["Mod-b", "Cmd-b", "mac", true],
    ["Mod-b", "Cmd-b", "other", false],
    ["Shift-Mod-k", "mod-shift-K", "mac", true],
    ["Mod-Shift-?", "shift-mod-?", "other", true],
    ["Mod-?", "Mod-/", "other", false],
  ] as const)("%s vs %s on %s → same: %s", (a, b, platform, same) => {
    expect(chordIdentity(a, platform) === chordIdentity(b, platform)).toBe(same);
  });
});

describe("isFixedAccelerator", () => {
  it("reserves F11 off macOS only", () => {
    expect(isFixedAccelerator("F11", "other")).toBe(true);
    expect(isFixedAccelerator("F11", "mac")).toBe(false);
    expect(isFixedAccelerator("Mod-F11", "other")).toBe(false);
    expect(isFixedAccelerator("", "other")).toBe(false);
  });

  it.each([" F11 ", "+F11", "f11", "\tF11", "\u0085F11\u0085"])(
    "reserves %j off macOS: the native menu would parse it as F11",
    (key) => {
      expect(isFixedAccelerator(key, "other")).toBe(true);
      expect(isFixedAccelerator(key, "mac")).toBe(false);
    },
  );

  it.each(["Shift+F11", "Ctrl-F11", "CmdOrCtrl+F11", "F1", "F111", "++F11"])(
    "does not reserve %j (a different chord, or one the native parser rejects)",
    (key) => {
      expect(isFixedAccelerator(key, "other")).toBe(false);
    },
  );

  it("no default shortcut sits on a fixed accelerator on its platform", () => {
    for (const def of DEFAULT_SHORTCUTS) {
      expect(isFixedAccelerator(def.defaultKeyMac ?? def.defaultKey, "mac"), def.id).toBe(false);
      expect(isFixedAccelerator(def.defaultKeyOther ?? def.defaultKey, "other"), def.id).toBe(false);
    }
  });
});

describe("reconcileCustomBindings", () => {
  it.each([null, undefined, "Mod-b", 7, true, ["Mod-b"]])("%j → {}", (raw) => {
    expect(reconcileCustomBindings(raw, "other")).toEqual({});
  });

  it("drops non-strings, keeps deliberate unbinds, unassigns fixed chords", () => {
    const raw = { a: "Mod-b", b: "", c: false, d: 0, e: null, f: { k: 1 }, g: "F11", h: "测试" };
    expect(reconcileCustomBindings(raw, "other")).toEqual({ a: "Mod-b", b: "", g: "", h: "测试" });
    expect(reconcileCustomBindings(raw, "mac")).toEqual({ a: "Mod-b", b: "", g: "F11", h: "测试" });
  });
});

describe("FIXED_ACCELERATORS mirrors the Rust menu builder", () => {
  const rustIds = (() => {
    const src = readFileSync(join(MENU_DIR, "accelerators.rs"), "utf8");
    const m = /FIXED_ACCELERATOR_IDS:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]/.exec(src);
    if (!m) throw new Error("FIXED_ACCELERATOR_IDS not found in accelerators.rs");
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  })();

  const menuSources = readdirSync(join(MENU_DIR, "localized"))
    .filter((f) => f.endsWith(".rs") && !f.includes(".test."))
    .map((f) => readFileSync(join(MENU_DIR, "localized", f), "utf8"));

  it("names the same menu ids", () => {
    expect(rustIds.length).toBeGreaterThan(0);
    expect(FIXED_ACCELERATORS.map((f) => f.menuId).sort()).toEqual(rustIds);
  });

  it.each(FIXED_ACCELERATORS.map((f) => [f.menuId, f] as const))(
    "%s: the builder binds the same literal accelerator, on the same platforms",
    (menuId, fixed) => {
      // The item: `#[cfg(...)]` then `MenuItem::with_id(app, "<id>", label,
      // enabled, Some("<accel>"))?` — the accelerator is read only from INSIDE
      // that call (the lazy body may not cross its `)?` terminator), and every
      // call site in every file counts toward the uniqueness check.
      const pattern = new RegExp(
        String.raw`#\[cfg\(([^\]]*)\)\]\s*&MenuItem::with_id\(\s*app,\s*"${menuId}",(?:(?!\)\?)[\s\S])*?Some\("([^"]+)"\),?\s*\)\?`,
        "g",
      );
      const hits = menuSources.flatMap((src) => [...src.matchAll(pattern)]);
      const sites = menuSources.reduce((n, src) => n + src.split(`"${menuId}"`).length - 1, 0);
      expect(hits, `exactly one builder site for ${menuId}`).toHaveLength(1);
      expect(sites, `${menuId} is named exactly once across the menu builder`).toBe(1);
      const [, cfg, accel] = hits[0];
      expect(accel).toBe(prosemirrorToTauri(fixed.key));
      const platformsFromCfg =
        cfg.replace(/\s/g, "") === 'not(target_os="macos")' ? ["other"]
          : cfg.replace(/\s/g, "") === 'target_os="macos"' ? ["mac"]
            : null;
      expect(platformsFromCfg, `unrecognised cfg for ${menuId}: ${cfg}`).not.toBeNull();
      expect([...fixed.platforms].sort()).toEqual(platformsFromCfg);
    },
  );
});
