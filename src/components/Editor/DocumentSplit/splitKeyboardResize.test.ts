// @vitest-environment node
// Audit 20260907 (#277): the keyboard half of the split divider, as a pure
// function — the arrow step, the Home/End jumps derived from the store
// bounds, and the keys the divider does not own.
import { describe, expect, it } from "vitest";
import { MIN_PANE_FRACTION, MAX_PANE_FRACTION } from "@/stores/paneStoreTypes";
import { KEYBOARD_STEP, keyboardResizeTarget } from "./splitKeyboardResize";

describe("keyboardResizeTarget", () => {
  it.each([
    ["ArrowLeft", 0.5, 0.5 - KEYBOARD_STEP],
    ["ArrowRight", 0.5, 0.5 + KEYBOARD_STEP],
    ["Home", 0.5, MIN_PANE_FRACTION],
    ["End", 0.5, MAX_PANE_FRACTION],
  ])("%s from %d asks for %d", (key, fraction, expected) => {
    expect(keyboardResizeTarget(key, fraction)).toBeCloseTo(expected, 10);
  });

  it("does not clamp — the store owns the bounds, exactly as for the drag", () => {
    expect(keyboardResizeTarget("ArrowLeft", MIN_PANE_FRACTION)).toBeLessThan(MIN_PANE_FRACTION);
    expect(keyboardResizeTarget("ArrowRight", MAX_PANE_FRACTION)).toBeGreaterThan(MAX_PANE_FRACTION);
  });

  it.each(["ArrowUp", "ArrowDown", "Enter", "Escape", " ", "a", ""])(
    "leaves %j with the browser — the split is always side-by-side (WI-FL3.10)",
    (key) => {
      expect(keyboardResizeTarget(key, 0.5)).toBeNull();
    },
  );
});

