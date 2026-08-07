// @vitest-environment node
/**
 * Unit tests for popupPosition utility.
 *
 * Tests the pure positioning logic without DOM dependencies.
 */
import { describe, it, expect } from "vitest";
import { calculatePopupPosition, type PositionOptions } from "./popupPosition";

// Helper to create standard test bounds
function createBounds(width = 800, height = 600) {
  return {
    horizontal: { left: 0, right: width },
    vertical: { top: 0, bottom: height },
  };
}

// Helper to create anchor rect
function createAnchor(x: number, y: number, width = 100, height = 20) {
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

describe("calculatePopupPosition", () => {
  describe("vertical positioning", () => {
    it("positions popup above anchor when space is sufficient (preferAbove=true)", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 300, 100, 20), // Middle of viewport
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
        preferAbove: true,
      };

      const result = calculatePopupPosition(options);

      // Should be above anchor: anchor.top - popup.height - gap = 300 - 50 - 8 = 242
      expect(result.top).toBe(242);
    });

    it("positions popup below anchor when no space above", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 30, 100, 20), // Near top
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
        preferAbove: true,
      };

      const result = calculatePopupPosition(options);

      // Not enough space above (30 < 50 + 8), should go below: anchor.bottom + gap = 50 + 8 = 58
      expect(result.top).toBe(58);
    });

    it("positions popup below anchor when preferAbove=false and space exists", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 300, 100, 20),
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
        preferAbove: false,
      };

      const result = calculatePopupPosition(options);

      // Should be below anchor: anchor.bottom + gap = 320 + 8 = 328
      expect(result.top).toBe(328);
    });

    it("falls back to above when preferAbove=false but no space below", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 540, 100, 20), // Near bottom, anchor bottom at 560
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
        preferAbove: false,
      };

      const result = calculatePopupPosition(options);

      // Space below: 600 - 560 = 40 < 58 (popup.height + gap), not enough
      // Falls back to above: 540 - 50 - 8 = 482
      expect(result.top).toBe(482);
    });

    it("uses overlap mode for large anchors exceeding available space", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 50, 100, 510), // Large anchor (50-560)
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
        preferAbove: true,
      };

      const result = calculatePopupPosition(options);

      // Space above: 50 < 58, not enough
      // Space below: 600 - 560 = 40 < 58, not enough
      // Overlap mode: visibleTop + gap = max(50, 0) + 8 = 58
      expect(result.top).toBe(58);
    });
  });

  describe("horizontal positioning", () => {
    it("horizontally centers popup on anchor", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 300, 100, 20), // Center at 400
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
      };

      const result = calculatePopupPosition(options);

      // Anchor center: (350 + 450) / 2 = 400
      // Popup left: 400 - 200/2 = 300
      expect(result.left).toBe(300);
    });

    it("constrains left edge to bounds", () => {
      const options: PositionOptions = {
        anchor: createAnchor(20, 300, 50, 20), // Near left edge
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
      };

      const result = calculatePopupPosition(options);

      // Anchor center: (20 + 70) / 2 = 45
      // Popup left would be: 45 - 100 = -55, but constrained to bounds.left + gap = 8
      expect(result.left).toBe(8);
    });

    it("constrains right edge to bounds", () => {
      const options: PositionOptions = {
        anchor: createAnchor(730, 300, 50, 20), // Near right edge
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
      };

      const result = calculatePopupPosition(options);

      // Anchor center: (730 + 780) / 2 = 755
      // Popup left would be: 755 - 100 = 655, but right edge would be 855 > 800
      // Constrained to: bounds.right - popup.width - gap = 800 - 200 - 8 = 592
      expect(result.left).toBe(592);
    });
  });

  describe("gap handling", () => {
    it("uses default gap of 6 when not specified", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 300, 100, 20),
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        // gap not specified
      };

      const result = calculatePopupPosition(options);

      // Default gap = 6, so top = 300 - 50 - 6 = 244
      expect(result.top).toBe(244);
    });

    it("respects custom gap value", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 300, 100, 20),
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 12,
      };

      const result = calculatePopupPosition(options);

      // Custom gap = 12, so top = 300 - 50 - 12 = 238
      expect(result.top).toBe(238);
    });
  });

  describe("bounds clamping", () => {
    it("clamps popup to stay within vertical bounds", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 10, 100, 20), // Very near top
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
        preferAbove: true,
      };

      const result = calculatePopupPosition(options);

      // Would go above (10 - 50 - 8 = -48), but clamped to bounds.top + gap = 8
      // Actually, not enough space above so goes below: 30 + 8 = 38
      expect(result.top).toBe(38);
    });

    it("clamps popup near bottom of bounds", () => {
      const options: PositionOptions = {
        anchor: createAnchor(350, 560, 100, 20), // Near bottom
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
        preferAbove: false,
      };

      const result = calculatePopupPosition(options);

      // preferAbove=false, would go below (580 + 8 = 588), but bottom edge 638 > 600
      // Falls back to above: 560 - 50 - 8 = 502
      expect(result.top).toBe(502);
    });
  });

  describe("edge cases", () => {
    it("handles zero-width popup", () => {
      const options: PositionOptions = {
        anchor: createAnchor(400, 300, 0, 20),
        popup: { width: 0, height: 50 },
        bounds: createBounds(),
        gap: 8,
      };

      const result = calculatePopupPosition(options);

      // Should not throw, left should be anchor center
      expect(result.left).toBe(400);
      expect(result.top).toBe(242);
    });

    it("handles anchor at exact bounds edge", () => {
      const options: PositionOptions = {
        anchor: { left: 0, top: 0, right: 100, bottom: 20 },
        popup: { width: 200, height: 50 },
        bounds: createBounds(),
        gap: 8,
      };

      const result = calculatePopupPosition(options);

      // Anchor at top-left corner
      // Horizontal: centered on 50, but constrained to left edge + gap = 8
      expect(result.left).toBe(8);
      // Vertical: no space above (0 < 58), goes below: 20 + 8 = 28
      expect(result.top).toBe(28);
    });
  });
});
