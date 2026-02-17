/**
 * Per-Table Fit-to-Width Tests
 *
 * Tests for ephemeral per-table fit-to-width toggle via DOM class.
 * State is intentionally ephemeral — resets on mode switch or reload.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isWrapperFitToWidth,
  setWrapperFitToWidth,
  toggleWrapperFitToWidth,
} from "../fitToWidth";

describe("fitToWidth", () => {
  let wrapper: HTMLDivElement;

  beforeEach(() => {
    wrapper = document.createElement("div");
    wrapper.className = "table-scroll-wrapper";
  });

  describe("isWrapperFitToWidth", () => {
    it("returns false for a wrapper without fit class", () => {
      expect(isWrapperFitToWidth(wrapper)).toBe(false);
    });

    it("returns true for a wrapper with fit class", () => {
      wrapper.classList.add("table-fit-to-width");
      expect(isWrapperFitToWidth(wrapper)).toBe(true);
    });
  });

  describe("setWrapperFitToWidth", () => {
    it("adds class when value is true", () => {
      setWrapperFitToWidth(wrapper, true);
      expect(wrapper.classList.contains("table-fit-to-width")).toBe(true);
    });

    it("removes class when value is false", () => {
      wrapper.classList.add("table-fit-to-width");
      setWrapperFitToWidth(wrapper, false);
      expect(wrapper.classList.contains("table-fit-to-width")).toBe(false);
    });

    it("is idempotent — adding twice doesn't duplicate", () => {
      setWrapperFitToWidth(wrapper, true);
      setWrapperFitToWidth(wrapper, true);
      expect(wrapper.className).toBe("table-scroll-wrapper table-fit-to-width");
    });
  });

  describe("toggleWrapperFitToWidth", () => {
    it("adds class when not present, returns true", () => {
      const result = toggleWrapperFitToWidth(wrapper);
      expect(result).toBe(true);
      expect(wrapper.classList.contains("table-fit-to-width")).toBe(true);
    });

    it("removes class when present, returns false", () => {
      wrapper.classList.add("table-fit-to-width");
      const result = toggleWrapperFitToWidth(wrapper);
      expect(result).toBe(false);
      expect(wrapper.classList.contains("table-fit-to-width")).toBe(false);
    });

    it("toggles back and forth", () => {
      expect(toggleWrapperFitToWidth(wrapper)).toBe(true);
      expect(toggleWrapperFitToWidth(wrapper)).toBe(false);
      expect(toggleWrapperFitToWidth(wrapper)).toBe(true);
    });
  });
});
