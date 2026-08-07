// @vitest-environment node
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
    // Case-insensitive (audit-fix #3): the store/canonicalizer accept these forms,
    // so a lowercase/mixed-case rebind must still produce the exact KeyboardEvent.key.
    ["Mod-Alt-up", "Mod-Alt-ArrowUp"],
    ["mod-alt-down", "mod-alt-ArrowDown"],
    ["arrowup", "ArrowUp"],
    ["ARROWLEFT", "ArrowLeft"],
    ["ArrowUp", "ArrowUp"], // already-prefixed is idempotent (no ArrowArrowUp)
  ])("converts arrow name %s → %s", (input, expected) => {
    expect(toProseMirrorKey(input)).toBe(expected);
  });

  it.each([
    ["PageUp"], // 'Up' is a substring, not a whole segment → unchanged
    ["PageDown"],
    ["Home"],
  ])("does not rewrite non-arrow keys containing a direction substring: %s", (input) => {
    expect(toProseMirrorKey(input)).toBe(input);
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
