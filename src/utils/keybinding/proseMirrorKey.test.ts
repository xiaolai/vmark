import { describe, it, expect } from "vitest";
import { toProseMirrorKey } from "./proseMirrorKey";

describe("toProseMirrorKey", () => {
  it.each([
    ["Alt-Up", "Alt-ArrowUp"],
    ["Mod-Shift-Down", "Mod-Shift-ArrowDown"],
    ["Left", "ArrowLeft"],
    ["Right", "ArrowRight"],
    ["Up", "ArrowUp"],
    ["Down", "ArrowDown"],
    ["Up-Down", "ArrowUp-ArrowDown"],
  ])("converts arrow name %s → %s", (input, expected) => {
    expect(toProseMirrorKey(input)).toBe(expected);
  });

  it.each([
    ["Mod-b"],
    ["Escape"],
    ["F5"],
    ["Mod-Shift-u"],
    [""],
  ])("passes non-arrow chord %s through unchanged", (input) => {
    expect(toProseMirrorKey(input)).toBe(input);
  });
});
