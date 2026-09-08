// @vitest-environment node
/**
 * The zoom step's MONOTONICITY (audit #941, re-homed by #942).
 *
 * The zoom bounds [12, 32] are narrower than the store's valid range for
 * `appearance.fontSize` ([8, 48]), so a size can legitimately sit outside them
 * — set by another surface, or restored from a session. A bare
 * `Math.min(current + step, MAX)` then SHRANK the text on Zoom In above MAX,
 * and `Math.max(current - step, MIN)` GREW it on Zoom Out below MIN. Clamping
 * toward a bound may stop a step; it must never reverse one.
 */
import { describe, expect, it } from "vitest";
import {
  FONT_SIZE_STEP,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  zoomStep,
} from "./viewZoomCommands";

describe("zoomStep — in", () => {
  it("steps up inside the range", () => {
    expect(zoomStep(18, FONT_SIZE_STEP, MAX_FONT_SIZE)).toBe(20);
  });

  it("stops at the bound rather than overshooting it", () => {
    expect(zoomStep(MAX_FONT_SIZE - 1, FONT_SIZE_STEP, MAX_FONT_SIZE)).toBe(MAX_FONT_SIZE);
    expect(zoomStep(MAX_FONT_SIZE, FONT_SIZE_STEP, MAX_FONT_SIZE)).toBe(MAX_FONT_SIZE);
  });

  it("never SHRINKS the text above the bound", () => {
    expect(zoomStep(40, FONT_SIZE_STEP, MAX_FONT_SIZE)).toBe(40);
    expect(zoomStep(48, FONT_SIZE_STEP, MAX_FONT_SIZE)).toBe(48);
  });
});

describe("zoomStep — out", () => {
  it("steps down inside the range", () => {
    expect(zoomStep(18, -FONT_SIZE_STEP, MIN_FONT_SIZE)).toBe(16);
  });

  it("stops at the bound rather than undershooting it", () => {
    expect(zoomStep(MIN_FONT_SIZE + 1, -FONT_SIZE_STEP, MIN_FONT_SIZE)).toBe(MIN_FONT_SIZE);
    expect(zoomStep(MIN_FONT_SIZE, -FONT_SIZE_STEP, MIN_FONT_SIZE)).toBe(MIN_FONT_SIZE);
  });

  it("never GROWS the text below the bound", () => {
    expect(zoomStep(10, -FONT_SIZE_STEP, MIN_FONT_SIZE)).toBe(10);
    expect(zoomStep(8, -FONT_SIZE_STEP, MIN_FONT_SIZE)).toBe(8);
  });
});
