// @vitest-environment node
/**
 * Toolbar Focus - Tests
 *
 * Tests for simple first-enabled focus algorithm.
 */
import { describe, it, expect } from "vitest";
import { getInitialFocusIndex } from "./toolbarFocus";

// Helper to create button states
function makeStates(disabled: boolean[]): { disabled: boolean; notImplemented: boolean; active: boolean }[] {
  return disabled.map((d) => ({ disabled: d, notImplemented: false, active: false }));
}

describe("getInitialFocusIndex", () => {
  it("returns first enabled button index", () => {
    const states = makeStates([false, false, false]);
    expect(getInitialFocusIndex({ states })).toBe(0);
  });

  it("skips disabled buttons at start", () => {
    const states = makeStates([true, true, false, false]);
    expect(getInitialFocusIndex({ states })).toBe(2);
  });

  it("returns -1 when all buttons disabled", () => {
    const states = makeStates([true, true, true]);
    expect(getInitialFocusIndex({ states })).toBe(-1);
  });

  it("returns -1 for empty states", () => {
    expect(getInitialFocusIndex({ states: [] })).toBe(-1);
  });

  it("returns 0 when only first button is enabled", () => {
    const states = makeStates([false, true, true]);
    expect(getInitialFocusIndex({ states })).toBe(0);
  });

  it("returns last index when only last button is enabled", () => {
    const states = makeStates([true, true, false]);
    expect(getInitialFocusIndex({ states })).toBe(2);
  });
});
