import { describe, it, expect } from "vitest";
import { computeTerminalPosition, pixelsToRatio } from "../useTerminalPosition";
import type { EffectiveTerminalPosition } from "@/stores/uiStore";

describe("computeTerminalPosition", () => {
  it.each([
    // Definite landscape (ratio >= 1.5) → always right
    { w: 1920, h: 1080, current: "bottom" as const, expected: "right" },
    { w: 1920, h: 1080, current: "right" as const, expected: "right" },
    { w: 2560, h: 1440, current: "bottom" as const, expected: "right" },

    // Definite portrait (ratio <= 0.85) → always bottom
    { w: 1080, h: 1920, current: "right" as const, expected: "bottom" },
    { w: 1080, h: 1920, current: "bottom" as const, expected: "bottom" },
    { w: 800, h: 1200, current: "bottom" as const, expected: "bottom" },

    // Ambiguous zone (0.85 < ratio < 1.5): use width tiebreaker with hysteresis
    // Threshold = 1440 (base). If current=bottom, threshold stays 1440. If current=right, threshold shifts down by 50 to 1390.

    // current=bottom, w >= 1440 → right
    { w: 1500, h: 1200, current: "bottom" as const, expected: "right" },
    { w: 1440, h: 1200, current: "bottom" as const, expected: "right" },

    // current=bottom, w < 1440 → bottom (stays)
    { w: 1400, h: 1200, current: "bottom" as const, expected: "bottom" },
    { w: 1200, h: 1000, current: "bottom" as const, expected: "bottom" },

    // current=right, w >= 1390 → right (hysteresis keeps it)
    { w: 1400, h: 1200, current: "right" as const, expected: "right" },
    { w: 1390, h: 1200, current: "right" as const, expected: "right" },

    // current=right, w < 1390 → bottom (hysteresis threshold crossed)
    { w: 1380, h: 1200, current: "right" as const, expected: "bottom" },
    { w: 1100, h: 1000, current: "right" as const, expected: "bottom" },

    // Edge: ratio exactly at boundary
    { w: 1500, h: 1000, current: "bottom" as const, expected: "right" }, // ratio 1.5 → landscape
    { w: 850, h: 1000, current: "right" as const, expected: "bottom" }, // ratio 0.85 → portrait

    // Edge: zero, negative, NaN, Infinity → return currentPosition unchanged
    { w: 0, h: 1080, current: "bottom" as const, expected: "bottom" },
    { w: 0, h: 1080, current: "right" as const, expected: "right" },
    { w: 1920, h: 0, current: "bottom" as const, expected: "bottom" },
    { w: 1920, h: 0, current: "right" as const, expected: "right" },
    { w: -100, h: 1080, current: "bottom" as const, expected: "bottom" },
    { w: 1920, h: -100, current: "right" as const, expected: "right" },
    { w: NaN, h: 1080, current: "bottom" as const, expected: "bottom" },
    { w: 1920, h: NaN, current: "right" as const, expected: "right" },
    { w: Infinity, h: 1080, current: "bottom" as const, expected: "bottom" },
  ])(
    "w=$w h=$h current=$current → $expected",
    ({ w, h, current, expected }: { w: number; h: number; current: EffectiveTerminalPosition; expected: string }) => {
      expect(computeTerminalPosition(w, h, current)).toBe(expected);
    }
  );
});

describe("pixelsToRatio", () => {
  it("computes ratio from pixel / available", () => {
    expect(pixelsToRatio(400, 1000)).toBeCloseTo(0.4);
    expect(pixelsToRatio(250, 1000)).toBeCloseTo(0.25);
  });

  it("clamps to 0.1 minimum", () => {
    expect(pixelsToRatio(10, 1000)).toBe(0.1);
    expect(pixelsToRatio(0, 1000)).toBe(0.1);
  });

  it("clamps to 0.8 maximum", () => {
    expect(pixelsToRatio(900, 1000)).toBe(0.8);
    expect(pixelsToRatio(1000, 1000)).toBe(0.8);
  });

  it("returns 0.4 when available dimension is 0", () => {
    expect(pixelsToRatio(400, 0)).toBe(0.4);
    expect(pixelsToRatio(400, -100)).toBe(0.4);
  });
});
