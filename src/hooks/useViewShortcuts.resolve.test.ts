import { describe, it, expect } from "vitest";
import { resolveViewAction, shouldSkipKeyEvent, type ViewAction } from "./useViewShortcuts";

function makeEvent(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
  target?: HTMLElement,
): KeyboardEvent {
  const evt = new KeyboardEvent("keydown", {
    key,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    bubbles: true,
  });
  if (target) Object.defineProperty(evt, "target", { value: target });
  return evt;
}

describe("shouldSkipKeyEvent", () => {
  it("returns false for normal key events", () => {
    expect(shouldSkipKeyEvent(makeEvent("a"))).toBe(false);
  });
  it("returns true for IME composition events (keyCode 229)", () => {
    const evt = new KeyboardEvent("keydown", { keyCode: 229 } as unknown as KeyboardEventInit);
    expect(shouldSkipKeyEvent(evt)).toBe(true);
  });
});

describe("resolveViewAction", () => {
  const shortcuts: Record<string, string> = {
    toggleTerminal: "Mod-`",
    sourceMode: "Mod-Shift-s",
    focusMode: "Mod-Shift-f",
    typewriterMode: "Mod-Shift-t",
    wordWrap: "Mod-Shift-w",
    lineNumbers: "Mod-Shift-l",
    readOnly: "Mod-Shift-r",
    fitTables: "Mod-Shift-y",
    validateMarkdown: "Mod-Shift-m",
    lintNext: "F2",
    lintPrev: "Shift-F2",
    toggleOutline: "Mod-Shift-o",
    fileExplorer: "Mod-Shift-e",
    viewHistory: "Mod-Shift-h",
  };

  it("returns null when no shortcut matches", () => {
    const div = document.createElement("div");
    expect(resolveViewAction(makeEvent("z", {}, div), shortcuts, "mac")).toBeNull();
  });

  it("resolves toggleTerminal even from a textarea", () => {
    const textarea = document.createElement("textarea");
    expect(
      resolveViewAction(makeEvent("`", { meta: true }, textarea), shortcuts, "mac"),
    ).toBe("toggleTerminal");
  });

  it("suppresses non-terminal shortcuts while focused in an input", () => {
    const input = document.createElement("input");
    expect(
      resolveViewAction(makeEvent("s", { meta: true, shift: true }, input), shortcuts, "mac"),
    ).toBeNull();
  });

  it("suppresses non-terminal shortcuts while focused in a textarea", () => {
    const textarea = document.createElement("textarea");
    expect(
      resolveViewAction(makeEvent("f", { meta: true, shift: true }, textarea), shortcuts, "mac"),
    ).toBeNull();
  });

  it.each<[string, Parameters<typeof makeEvent>[1], ViewAction]>([
    ["s", { meta: true, shift: true }, "sourceMode"],
    ["f", { meta: true, shift: true }, "focusMode"],
    ["t", { meta: true, shift: true }, "typewriterMode"],
    ["w", { meta: true, shift: true }, "wordWrap"],
    ["l", { meta: true, shift: true }, "lineNumbers"],
    ["r", { meta: true, shift: true }, "readOnly"],
    ["y", { meta: true, shift: true }, "fitTables"],
    ["m", { meta: true, shift: true }, "validateMarkdown"],
    ["F2", {}, "lintNext"],
    ["F2", { shift: true }, "lintPrev"],
    ["o", { meta: true, shift: true }, "toggleOutline"],
    ["e", { meta: true, shift: true }, "fileExplorer"],
    ["h", { meta: true, shift: true }, "viewHistory"],
  ])("resolves %s+modifiers -> %s", (key, mods, expected) => {
    const div = document.createElement("div");
    expect(resolveViewAction(makeEvent(key, mods, div), shortcuts, "mac")).toBe(expected);
  });

  it("skips entries whose binding is empty / undefined", () => {
    const sparse: Record<string, string> = {};
    const div = document.createElement("div");
    expect(
      resolveViewAction(makeEvent("s", { meta: true, shift: true }, div), sparse, "mac"),
    ).toBeNull();
  });

  it("uses the 'other' platform path when explicitly set", () => {
    const div = document.createElement("div");
    expect(
      resolveViewAction(makeEvent("s", { ctrl: true, shift: true }, div), shortcuts, "other"),
    ).toBe("sourceMode");
  });
});
