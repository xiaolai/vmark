// The docs-notation renderer shared by the keybinding gate and the lint-table doc join.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prosemirrorToTauri as appProsemirrorToTauri } from "@/stores/settingsStore/keyFormatting";
import { keyTokens, prosemirrorToDocs, prosemirrorToTauri } from "./keybindingFormat.mjs";

describe("keyTokens", () => {
  it.each([
    ["Mod-Shift-n", ["Mod", "Shift", "n"]],
    ["Alt-Mod-]", ["Alt", "Mod", "]"]],
    ["Mod--", ["Mod", "-"]],
    ["Alt-Mod--", ["Alt", "Mod", "-"]],
    ["-", ["-"]],
    ["F8", ["F8"]],
  ])("%j → %j", (key, tokens) => {
    expect(keyTokens(key)).toEqual(tokens);
  });

  it("rejects an empty token anywhere but the minus-key tail, instead of normalising a chord the app never binds", () => {
    expect(() => keyTokens("Mod--Shift-A")).toThrow(/malformed shortcut key "Mod--Shift-A": empty token at position 1/);
    expect(() => keyTokens("-Mod-A")).toThrow(/empty token at position 0/);
    expect(() => keyTokens("Mod---")).toThrow(/empty token at position 1/);
  });

  // audit R2 #186 — the minus KEY is the `--` pair, not any trailing empty.
  // `Mod-` is a dangling separator with no key; it used to render as `Mod + -`,
  // exactly like the real `Mod--`, and `keyTokens("")` returned ["-"].
  it("rejects a dangling trailing separator and an empty key", () => {
    expect(() => keyTokens("Mod-")).toThrow(/malformed shortcut key "Mod-": empty token at position 1/);
    expect(() => keyTokens("Alt-Mod-")).toThrow(/empty token at position 2/);
    expect(() => keyTokens("")).toThrow(/malformed shortcut key "": empty token at position 0/);
  });
});

describe("prosemirrorToDocs", () => {
  it.each([
    ["Mod-Shift-n", "Mod + Shift + N"],
    ["Alt-Mod-l", "Alt + Mod + L"],
    ["Mod--", "Mod + -"],
    ["Mod-é", "Mod + É"],
    ["Mod-\u{10428}", "Mod + \u{10400}"], // Deseret small long-i → capital: an astral letter is one code point, two UTF-16 units
    ["Mod-ǆ", "Mod + Ǆ"], // a letter whose upper-case is a different single code point
    ["Mod-1", "Mod + 1"],
    ["Mod-Enter", "Mod + Enter"],
    ["", ""],
  ])("%j → %j", (key, docs) => {
    expect(prosemirrorToDocs(key)).toBe(docs);
  });
});

// audit R3 #57 — `prosemirrorToTauri` exists twice: here (plain node, for the
// keybinding gate) and in the app's `keyFormatting.ts`. The gate compares every
// Rust menu accelerator against ITS copy, so a divergence would not report
// drift — it would silently redefine what "aligned" means. The port used to be
// governed by a "keep in sync" comment; this is the check that comment implied.
describe("prosemirrorToTauri parity with the app's converter", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "stores", "settingsStore", "shortcutDefinitions.ts"),
    "utf8",
  );
  // Every key literal the definitions bind, whatever the field — the real
  // corpus, so the parity claim covers what actually ships rather than a
  // hand-picked sample.
  const shipped = [
    ...new Set(
      [...source.matchAll(/\bdefaultKey(?:Mac|Other)?:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)),
    ),
  ];

  it("reads a non-trivial corpus of shipped keys (a parity test over nothing proves nothing)", () => {
    expect(shipped.length).toBeGreaterThan(50);
  });

  it.each([
    ...shipped,
    "",
    "Mod-b",
    "Mod--",
    "Alt-Mod--",
    "Mod-Shift-`",
    "Mod-Shift-N",
    "F8",
    "Mod-Enter",
    "Ctrl-Alt-Shift-1",
    "-",
  ])("agrees on %j", (key) => {
    expect(prosemirrorToTauri(key)).toBe(appProsemirrorToTauri(key));
  });
});
