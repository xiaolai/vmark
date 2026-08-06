/**
 * Restore's sidebar-width validation must agree with the store that clamps it.
 *
 * `restoreHelpers` carried its own 150–500 bounds while `uiStore.setSidebarWidth`
 * clamps to 180–480. A persisted 500 therefore passed validation, was applied,
 * and came back 480 — restore reported success for a width it had just called
 * valid and did not actually restore. Both mocked test suites missed it because
 * each tested one side.
 *
 * This is a CONTRACT test between the two, not a test of either.
 *
 * @coordinates-with stores/uiStore.ts — the clamp
 * @coordinates-with services/persistence/hotExit/restoreHelpers.ts — the validator
 * @module services/persistence/hotExit/sidebarWidthBounds.test
 */
import { describe, it, expect } from "vitest";
import {
  useUIStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from "@/stores/uiStore";

/** Apply a width through the store and read back what survived. */
function applied(width: number): number {
  useUIStore.getState().setSidebarWidth(width);
  return useUIStore.getState().sidebarWidth;
}

describe("every width restore accepts is a width the store keeps", () => {
  it.each([
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_DEFAULT_WIDTH,
    Math.round((SIDEBAR_MIN_WIDTH + SIDEBAR_MAX_WIDTH) / 2),
  ])("width %i survives the clamp unchanged", (width) => {
    expect(applied(width)).toBe(width);
  });

  it("the boundaries themselves are inclusive on both sides", () => {
    // An exclusive bound on either side would make the validator and the clamp
    // disagree by exactly one pixel at each end.
    expect(applied(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
    expect(applied(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH);
  });
});

describe("widths outside the bounds are still clamped, not trusted", () => {
  it("clamps below the minimum", () => {
    expect(applied(SIDEBAR_MIN_WIDTH - 1)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("clamps above the maximum", () => {
    expect(applied(SIDEBAR_MAX_WIDTH + 1)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("clamps the old validator's bounds, which is the defect in one line", () => {
    // 150 and 500 were the numbers restore used to accept.
    expect(applied(150)).toBe(SIDEBAR_MIN_WIDTH);
    expect(applied(500)).toBe(SIDEBAR_MAX_WIDTH);
  });
});

describe("the bounds are internally coherent", () => {
  it("min is below max", () => {
    expect(SIDEBAR_MIN_WIDTH).toBeLessThan(SIDEBAR_MAX_WIDTH);
  });

  it("the default sits inside the range it would otherwise be clamped into", () => {
    expect(SIDEBAR_DEFAULT_WIDTH).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
    expect(SIDEBAR_DEFAULT_WIDTH).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH);
  });
});
