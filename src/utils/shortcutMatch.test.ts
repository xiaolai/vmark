import { describe, it, expect, vi } from "vitest";
import { matchesShortcutEvent, isMacPlatform } from "@/utils/shortcutMatch";

function makeEvent(options: KeyboardEventInit & { key: string }) {
  return new KeyboardEvent("keydown", options);
}

describe("matchesShortcutEvent", () => {
  it("matches Mod-/ on mac (source mode toggle)", () => {
    const event = makeEvent({ key: "/", metaKey: true });
    expect(matchesShortcutEvent(event, "Mod-/", "mac")).toBe(true);
  });

  it("matches Mod-/ on non-mac (source mode toggle)", () => {
    const event = makeEvent({ key: "/", ctrlKey: true });
    expect(matchesShortcutEvent(event, "Mod-/", "other")).toBe(true);
  });

  it("matches Mod-Shift-P on mac", () => {
    const event = makeEvent({ key: "P", metaKey: true, shiftKey: true });
    expect(matchesShortcutEvent(event, "Mod-Shift-p", "mac")).toBe(true);
  });

  it("matches Mod-Shift-P on non-mac", () => {
    const event = makeEvent({ key: "p", ctrlKey: true, shiftKey: true });
    expect(matchesShortcutEvent(event, "Mod-Shift-p", "other")).toBe(true);
  });

  it("rejects extra modifiers", () => {
    const event = makeEvent({ key: "p", ctrlKey: true, shiftKey: true, altKey: true });
    expect(matchesShortcutEvent(event, "Mod-Shift-p", "other")).toBe(false);
  });

  it("matches Alt-z", () => {
    const event = makeEvent({ key: "z", altKey: true });
    expect(matchesShortcutEvent(event, "Alt-z", "other")).toBe(true);
  });

  it("matches arrow key aliases", () => {
    const event = makeEvent({ key: "ArrowUp", ctrlKey: true, shiftKey: true });
    expect(matchesShortcutEvent(event, "Ctrl-Shift-Up", "other")).toBe(true);
  });

  it("matches shifted symbol variants", () => {
    const event = makeEvent({ key: "?", shiftKey: true, metaKey: true });
    expect(matchesShortcutEvent(event, "Mod-Shift-/", "mac")).toBe(true);
  });

  it("matches shifted . to >", () => {
    const event = makeEvent({ key: ">", shiftKey: true, metaKey: true });
    expect(matchesShortcutEvent(event, "Mod-Shift-.", "mac")).toBe(true);
  });

  describe("CJK IME remapping", () => {
    it.each([
      { name: "Ctrl-` with backtick remapped to middle dot", key: "\u00B7", code: "Backquote", init: { ctrlKey: true }, shortcut: "Ctrl-`", platform: "mac" as const },
      { name: "Mod-Shift-` with backtick remapped (inline code)", key: "\u00B7", code: "Backquote", init: { metaKey: true, shiftKey: true }, shortcut: "Mod-Shift-`", platform: "mac" as const },
      { name: "Mod-[ with bracket remapped to lenticular bracket", key: "\u3010", code: "BracketLeft", init: { metaKey: true }, shortcut: "Mod-[", platform: "mac" as const },
      { name: "Ctrl-` with correct event.key (no remapping)", key: "`", code: "Backquote", init: { ctrlKey: true }, shortcut: "Ctrl-`", platform: "mac" as const },
    ])("matches $name", ({ key, code, init, shortcut, platform }) => {
      const event = makeEvent({ key, code, ...init });
      expect(matchesShortcutEvent(event, shortcut, platform)).toBe(true);
    });

    it("rejects when modifier is missing (code fallback does not bypass modifier check)", () => {
      const event = makeEvent({ key: "\u00B7", code: "Backquote" });
      expect(matchesShortcutEvent(event, "Ctrl-`", "mac")).toBe(false);
    });

    it("rejects when event.code is wrong", () => {
      const event = makeEvent({ key: "\u00B7", code: "KeyA", ctrlKey: true });
      expect(matchesShortcutEvent(event, "Ctrl-`", "mac")).toBe(false);
    });

    it("rejects when event.code is empty", () => {
      const event = makeEvent({ key: "\u00B7", code: "", ctrlKey: true });
      expect(matchesShortcutEvent(event, "Ctrl-`", "mac")).toBe(false);
    });
  });
});

describe("isMacPlatform", () => {
  it("returns true when navigator.platform contains Mac", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(isMacPlatform()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("returns false on Windows", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(isMacPlatform()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns false on Linux", () => {
    vi.stubGlobal("navigator", { platform: "Linux x86_64" });
    expect(isMacPlatform()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns true for iPad", () => {
    vi.stubGlobal("navigator", { platform: "iPad" });
    expect(isMacPlatform()).toBe(true);
    vi.unstubAllGlobals();
  });
});
