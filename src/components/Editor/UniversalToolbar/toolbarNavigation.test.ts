// @vitest-environment node
/**
 * Toolbar Navigation - Tests
 *
 * Tests for linear keyboard navigation (simplified per redesign spec).
 */
import { describe, it, expect } from "vitest";
import {
  getNextFocusableIndex,
  getPrevFocusableIndex,
  getFirstFocusableIndex,
  getLastFocusableIndex,
} from "./toolbarNavigation";
import { TOOLBAR_GROUPS } from "./toolbarGroups";

// Helper to get total button count
function getTotalButtonCount(): number {
  return TOOLBAR_GROUPS.length;
}

describe("toolbarNavigation", () => {
  const total = getTotalButtonCount();

  describe("getNextFocusableIndex", () => {
    it("returns next focusable index when all are focusable", () => {
      const allFocusable = () => true;
      expect(getNextFocusableIndex(0, total, allFocusable)).toBe(1);
      expect(getNextFocusableIndex(5, total, allFocusable)).toBe(6);
    });

    it("skips non-focusable buttons", () => {
      // Only even indices are focusable
      const evenOnly = (i: number) => i % 2 === 0;
      expect(getNextFocusableIndex(0, total, evenOnly)).toBe(2);
      expect(getNextFocusableIndex(2, total, evenOnly)).toBe(4);
    });

    it("wraps to first focusable at end", () => {
      const allFocusable = () => true;
      expect(getNextFocusableIndex(total - 1, total, allFocusable)).toBe(0);
    });

    it("stays at current if no focusable found", () => {
      const noneFocusable = () => false;
      expect(getNextFocusableIndex(3, total, noneFocusable)).toBe(3);
    });
  });

  describe("getPrevFocusableIndex", () => {
    it("returns previous focusable index when all are focusable", () => {
      const allFocusable = () => true;
      expect(getPrevFocusableIndex(5, total, allFocusable)).toBe(4);
      expect(getPrevFocusableIndex(1, total, allFocusable)).toBe(0);
    });

    it("skips non-focusable buttons", () => {
      // Only even indices are focusable
      const evenOnly = (i: number) => i % 2 === 0;
      expect(getPrevFocusableIndex(4, total, evenOnly)).toBe(2);
      expect(getPrevFocusableIndex(2, total, evenOnly)).toBe(0);
    });

    it("wraps to last focusable at start", () => {
      const allFocusable = () => true;
      expect(getPrevFocusableIndex(0, total, allFocusable)).toBe(total - 1);
    });

    it("stays at current if no focusable found", () => {
      const noneFocusable = () => false;
      expect(getPrevFocusableIndex(3, total, noneFocusable)).toBe(3);
    });
  });

  describe("getFirstFocusableIndex", () => {
    it("returns 0 when first button is focusable", () => {
      const allFocusable = () => true;
      expect(getFirstFocusableIndex(total, allFocusable)).toBe(0);
    });

    it("skips initial non-focusable buttons", () => {
      // First two are disabled
      const skipFirst2 = (i: number) => i >= 2;
      expect(getFirstFocusableIndex(total, skipFirst2)).toBe(2);
    });

    it("returns 0 when none focusable", () => {
      const noneFocusable = () => false;
      expect(getFirstFocusableIndex(total, noneFocusable)).toBe(0);
    });

    it("handles empty list", () => {
      const allFocusable = () => true;
      expect(getFirstFocusableIndex(0, allFocusable)).toBe(0);
    });
  });

  describe("getLastFocusableIndex", () => {
    it("returns last index when last button is focusable", () => {
      const allFocusable = () => true;
      expect(getLastFocusableIndex(total, allFocusable)).toBe(total - 1);
    });

    it("skips trailing non-focusable buttons", () => {
      // Last two are disabled (only indices < total-2 are focusable)
      const skipLast2 = (i: number) => i < total - 2;
      expect(getLastFocusableIndex(total, skipLast2)).toBe(total - 3);
    });

    it("returns last index when none focusable", () => {
      const noneFocusable = () => false;
      expect(getLastFocusableIndex(total, noneFocusable)).toBe(total - 1);
    });

    it("handles empty list", () => {
      const allFocusable = () => true;
      expect(getLastFocusableIndex(0, allFocusable)).toBe(0);
    });
  });
});
