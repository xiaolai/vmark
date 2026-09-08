// @vitest-environment node
// Audit R3 #614 — the picker's key map and index arithmetic, out of the
// 76-line callback that used to hold both.
import { describe, expect, it } from "vitest";
import { inputModeIntent, nextScope, nextSelectedIndex, SCOPES } from "./geniePickerKeys";

describe("inputModeIntent", () => {
  it.each([
    ["Escape", "close"],
    ["ArrowDown", "next"],
    ["ArrowUp", "previous"],
    ["Home", "first"],
    ["End", "last"],
    ["Tab", "cycle-scope"],
    ["Enter", "submit"],
  ] as const)("%s → %s", (key, intent) => {
    expect(inputModeIntent(key, false)).toBe(intent);
  });

  it("leaves Shift+Enter to the textarea — it is a newline, not a submission", () => {
    expect(inputModeIntent("Enter", true)).toBeNull();
  });

  it.each(["a", "1", " ", "F5", "Backspace", ""])("leaves %o alone", (key) => {
    expect(inputModeIntent(key, false)).toBeNull();
  });
});

describe("nextSelectedIndex", () => {
  it("wraps forward past the end", () => {
    expect(nextSelectedIndex(2, "next", 3)).toBe(0);
  });

  it("wraps backward past the start", () => {
    expect(nextSelectedIndex(0, "previous", 3)).toBe(2);
  });

  it.each([
    ["first", 0],
    ["last", 2],
  ] as const)("%s jumps to %d", (intent, expected) => {
    expect(nextSelectedIndex(1, intent, 3)).toBe(expected);
  });

  it("holds at 0 for an EMPTY list rather than producing -1", () => {
    // A negative index would be written into `aria-activedescendant`.
    for (const intent of ["next", "previous", "first", "last"] as const) {
      expect(nextSelectedIndex(0, intent, 0)).toBe(0);
    }
  });

  it("leaves the index alone for an intent that does not move it", () => {
    expect(nextSelectedIndex(1, "submit", 3)).toBe(1);
    expect(nextSelectedIndex(1, "close", 3)).toBe(1);
  });
});

describe("nextScope", () => {
  it("cycles through every scope and then back to none", () => {
    expect(nextScope(null)).toBe(SCOPES[0]);
    expect(nextScope("selection")).toBe("block");
    expect(nextScope("block")).toBe("document");
    expect(nextScope("document")).toBeNull();
  });
});
