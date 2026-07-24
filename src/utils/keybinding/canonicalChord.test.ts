// WI-0.1 — the canonicalizer identity contract (the registry's foundation).
/**
 * Canonical chord corpus. The core property: a definition string and the
 * KeyboardEvent a user would press for it canonicalize to the SAME chord, across
 * layouts / CJK IME / shifted symbols / the `-` separator / numpad / platforms.
 * If this contract is unsound the whole registry is unsound (WI-0.1 is a blocker).
 */
import { describe, it, expect } from "vitest";
import {
  canonicalizeChordString,
  canonicalizeEvent,
  type Platform,
} from "./canonicalChord";

function evt(
  code: string,
  mods: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {},
) {
  return {
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  };
}

describe("canonicalizeChordString", () => {
  it("maps letters/digits/F-keys to physical codes", () => {
    expect(canonicalizeChordString("Mod-n", "mac")).toBe("meta+KeyN");
    expect(canonicalizeChordString("Mod-Shift-1", "mac")).toBe("meta+shift+Digit1");
    expect(canonicalizeChordString("F5", "mac")).toBe("F5");
    expect(canonicalizeChordString("F12", "other")).toBe("F12");
  });

  it("maps every symbol token to its code", () => {
    const cases: Array<[string, string]> = [
      ["Mod-`", "meta+Backquote"],
      ["Mod-=", "meta+Equal"],
      ["Mod-[", "meta+BracketLeft"],
      ["Mod-]", "meta+BracketRight"],
      ["Mod-\\", "meta+Backslash"],
      ["Mod-;", "meta+Semicolon"],
      ["Mod-'", "meta+Quote"],
      ["Mod-,", "meta+Comma"],
      ["Mod-.", "meta+Period"],
      ["Mod-/", "meta+Slash"],
    ];
    for (const [def, expected] of cases) {
      expect(canonicalizeChordString(def, "mac")).toBe(expected);
    }
  });

  it("handles the `-` separator / trailing-minus convention", () => {
    // `Mod--` (zoomOut) and `Alt-Mod--` (horizontalLine): base key IS `-`.
    expect(canonicalizeChordString("Mod--", "mac")).toBe("meta+Minus");
    expect(canonicalizeChordString("Alt-Mod--", "mac")).toBe("meta+alt+Minus");
  });

  it("named keys (arrows / enter / escape / tab) map to codes", () => {
    expect(canonicalizeChordString("Up", "mac")).toBe("ArrowUp");
    expect(canonicalizeChordString("Mod-Shift-Down", "mac")).toBe("meta+shift+ArrowDown");
    expect(canonicalizeChordString("Enter", "mac")).toBe("Enter");
    expect(canonicalizeChordString("Escape", "mac")).toBe("Escape");
    expect(canonicalizeChordString("Return", "mac")).toBe("Enter"); // alias
    expect(canonicalizeChordString("Esc", "mac")).toBe("Escape"); // alias
  });

  it("accepts already-normalized `Arrow*` names (case-insensitive), like the store / ProseMirror layers", () => {
    // A chord authored/imported as `Mod-ArrowUp` must canonicalize to the SAME
    // code as `Mod-Up` — otherwise it resolves to null and silently vanishes from
    // the registry while `toProseMirrorKey` still accepts it (round-3 audit fix).
    expect(canonicalizeChordString("ArrowUp", "mac")).toBe("ArrowUp");
    expect(canonicalizeChordString("Mod-ArrowUp", "mac")).toBe(
      canonicalizeChordString("Mod-Up", "mac"),
    );
    expect(canonicalizeChordString("arrowdown", "mac")).toBe("ArrowDown");
    expect(canonicalizeChordString("Mod-Shift-ArrowLeft", "mac")).toBe("meta+shift+ArrowLeft");
    expect(canonicalizeChordString("ARROWRIGHT", "mac")).toBe("ArrowRight");
  });

  it("is deterministic in modifier order regardless of authored order", () => {
    expect(canonicalizeChordString("Shift-Alt-Mod-k", "mac")).toBe(
      canonicalizeChordString("Mod-Alt-Shift-k", "mac"),
    );
    expect(canonicalizeChordString("Mod-Alt-Shift-k", "mac")).toBe("meta+alt+shift+KeyK");
  });

  it("resolves Mod per platform; Mod and Ctrl COLLIDE on non-mac", () => {
    expect(canonicalizeChordString("Mod-n", "mac")).toBe("meta+KeyN");
    expect(canonicalizeChordString("Mod-n", "other")).toBe("ctrl+KeyN");
    expect(canonicalizeChordString("Ctrl-n", "mac")).toBe("ctrl+KeyN");
    // On Windows/Linux Mod == Ctrl → same chord (a real, detectable collision).
    expect(canonicalizeChordString("Ctrl-n", "other")).toBe(
      canonicalizeChordString("Mod-n", "other"),
    );
    // On mac they are distinct.
    expect(canonicalizeChordString("Ctrl-n", "mac")).not.toBe(
      canonicalizeChordString("Mod-n", "mac"),
    );
  });

  it("dedupes Mod+Ctrl on non-mac to a single ctrl", () => {
    expect(canonicalizeChordString("Mod-Ctrl-k", "other")).toBe("ctrl+KeyK");
  });

  it("rejects unknown base keys and unknown modifiers", () => {
    expect(canonicalizeChordString("Mod-£", "mac")).toBeNull();
    expect(canonicalizeChordString("Hyper-k", "mac")).toBeNull();
    expect(canonicalizeChordString("", "mac")).toBeNull();
  });
});

describe("canonicalizeEvent", () => {
  it("mirrors canonicalizeChordString for the same chord (the core invariant)", () => {
    // (definition, platform, the event a user presses)
    const cases: Array<[string, Platform, ReturnType<typeof evt>]> = [
      ["Mod-n", "mac", evt("KeyN", { metaKey: true })],
      ["Mod-n", "other", evt("KeyN", { ctrlKey: true })],
      ["Mod-Shift-1", "mac", evt("Digit1", { metaKey: true, shiftKey: true })],
      ["Alt-Mod--", "mac", evt("Minus", { altKey: true, metaKey: true })],
      ["F5", "mac", evt("F5")],
      ["Mod-Shift-Down", "other", evt("ArrowDown", { ctrlKey: true, shiftKey: true })],
      ["Ctrl-`", "mac", evt("Backquote", { ctrlKey: true })],
    ];
    for (const [def, platform, event] of cases) {
      expect(canonicalizeEvent(event)).toBe(canonicalizeChordString(def, platform));
    }
  });

  it("CJK IME: event.key is remapped but event.code is preserved → still matches", () => {
    // Under a CJK IME, Mod+` may report event.key "·" but event.code stays
    // "Backquote". Canonicalization uses code, so it matches the definition.
    const cjkEvent = { ...evt("Backquote", { metaKey: true }) };
    expect(canonicalizeEvent(cjkEvent)).toBe(canonicalizeChordString("Mod-`", "mac"));
  });

  it("numpad keeps a distinct identity from the main row", () => {
    expect(canonicalizeEvent(evt("NumpadEnter"))).toBe("NumpadEnter");
    expect(canonicalizeEvent(evt("NumpadEnter"))).not.toBe(
      canonicalizeEvent(evt("Enter")),
    );
    expect(canonicalizeEvent(evt("Numpad1", { metaKey: true }))).toBe("meta+Numpad1");
  });

  it("a modifier-only press is not a chord (returns null)", () => {
    expect(canonicalizeEvent(evt("ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(canonicalizeEvent(evt("ControlRight", { ctrlKey: true }))).toBeNull();
    expect(canonicalizeEvent(evt("MetaLeft", { metaKey: true }))).toBeNull();
    expect(canonicalizeEvent(evt("CapsLock"))).toBeNull();
  });

  it("Caps Lock / Fn state do not enter the chord (only meta/ctrl/alt/shift do)", () => {
    // A normal key pressed while CapsLock is on — CapsLock is not a modifier here.
    expect(canonicalizeEvent(evt("KeyA"))).toBe("KeyA");
  });

  it("dead-key / Process events still resolve via code", () => {
    // event.key would be "Dead"/"Process"; code is the physical key.
    expect(canonicalizeEvent(evt("KeyE", { altKey: true }))).toBe("alt+KeyE");
  });

  it("AltGr (ctrl+alt composite) does NOT match a Ctrl-Alt chord — it is a typing modifier", () => {
    // ISO/international layouts: AltGr reports ctrlKey+altKey true, but
    // getModifierState("AltGraph") is true → composing a char (e.g. AltGr+E → €),
    // NOT invoking a Ctrl+Alt shortcut. Must resolve to null so no binding fires.
    const altGr = {
      code: "KeyE",
      metaKey: false,
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      getModifierState: (k: string) => k === "AltGraph",
    };
    expect(canonicalizeEvent(altGr)).toBeNull();

    // A genuine Ctrl+Alt press (AltGraph NOT active) still resolves as a chord.
    const realCtrlAlt = {
      code: "KeyE",
      metaKey: false,
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      getModifierState: () => false,
    };
    expect(canonicalizeEvent(realCtrlAlt)).toBe("ctrl+alt+KeyE");
  });

  it("empty/absent code yields null", () => {
    expect(canonicalizeEvent(evt("", { ctrlKey: true }))).toBeNull();
  });
});
