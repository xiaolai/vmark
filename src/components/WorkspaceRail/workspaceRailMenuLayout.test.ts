// @vitest-environment node
// Audit R3 #656 — the clamp arithmetic, including the case the component's
// inline version got wrong by omission: a menu that does not fit at all.
import { describe, expect, it } from "vitest";
import { clampToViewport, VIEWPORT_MARGIN } from "./workspaceRailMenuLayout";

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 200, height: 120 };

describe("clampToViewport", () => {
  it("leaves a menu that fits where the pointer put it", () => {
    expect(clampToViewport({ x: 300, y: 400 }, MENU, VIEWPORT)).toEqual({ x: 300, y: 400 });
  });

  it("pulls a menu opened near the right edge back inside", () => {
    expect(clampToViewport({ x: 990, y: 100 }, MENU, VIEWPORT).x).toBe(
      VIEWPORT.width - MENU.width - VIEWPORT_MARGIN,
    );
  });

  it("pulls a menu opened near the bottom edge back inside", () => {
    expect(clampToViewport({ x: 100, y: 795 }, MENU, VIEWPORT).y).toBe(
      VIEWPORT.height - MENU.height - VIEWPORT_MARGIN,
    );
  });

  it("keeps the near margin when the pointer is above or left of it", () => {
    expect(clampToViewport({ x: -50, y: 0 }, MENU, VIEWPORT)).toEqual({
      x: VIEWPORT_MARGIN,
      y: VIEWPORT_MARGIN,
    });
  });

  it("never returns a negative coordinate for a menu larger than the viewport", () => {
    // `min` alone would place a too-tall menu at a negative y — further off
    // screen than the raw pointer position, and unreachable.
    const at = clampToViewport({ x: 400, y: 400 }, { width: 2000, height: 2000 }, VIEWPORT);
    expect(at).toEqual({ x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN });
  });

  it("reacts to a SHRINKING viewport, which is what a window resize is", () => {
    const at = { x: 900, y: 700 };
    expect(clampToViewport(at, MENU, VIEWPORT)).toEqual({ x: 792, y: 672 });
    expect(clampToViewport(at, MENU, { width: 500, height: 400 })).toEqual({ x: 292, y: 272 });
  });
});
