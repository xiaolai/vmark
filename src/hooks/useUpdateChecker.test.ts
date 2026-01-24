/**
 * Tests for useUpdateChecker hook
 */

import { describe, it, expect } from "vitest";
import { shouldCheckNow } from "./useUpdateChecker";

const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;

describe("shouldCheckNow", () => {
  describe("when autoCheckEnabled is false", () => {
    it("returns false regardless of frequency", () => {
      expect(shouldCheckNow(false, "startup", null)).toBe(false);
      expect(shouldCheckNow(false, "daily", null)).toBe(false);
      expect(shouldCheckNow(false, "weekly", null)).toBe(false);
      expect(shouldCheckNow(false, "manual", null)).toBe(false);
    });
  });

  describe('when frequency is "manual"', () => {
    it("returns false even when autoCheck is enabled", () => {
      expect(shouldCheckNow(true, "manual", null)).toBe(false);
      expect(shouldCheckNow(true, "manual", Date.now() - ONE_WEEK * 2)).toBe(false);
    });
  });

  describe('when frequency is "startup"', () => {
    it("always returns true when autoCheck is enabled", () => {
      expect(shouldCheckNow(true, "startup", null)).toBe(true);
      expect(shouldCheckNow(true, "startup", Date.now())).toBe(true);
      expect(shouldCheckNow(true, "startup", Date.now() - ONE_WEEK)).toBe(true);
    });
  });

  describe('when frequency is "daily"', () => {
    it("returns true when lastCheck is null", () => {
      expect(shouldCheckNow(true, "daily", null)).toBe(true);
    });

    it("returns true when more than one day has passed", () => {
      const moreThanADayAgo = Date.now() - ONE_DAY - 1000;
      expect(shouldCheckNow(true, "daily", moreThanADayAgo)).toBe(true);
    });

    it("returns false when less than one day has passed", () => {
      const lessThanADayAgo = Date.now() - ONE_DAY + 60000;
      expect(shouldCheckNow(true, "daily", lessThanADayAgo)).toBe(false);
    });
  });

  describe('when frequency is "weekly"', () => {
    it("returns true when lastCheck is null", () => {
      expect(shouldCheckNow(true, "weekly", null)).toBe(true);
    });

    it("returns true when more than one week has passed", () => {
      const moreThanAWeekAgo = Date.now() - ONE_WEEK - 1000;
      expect(shouldCheckNow(true, "weekly", moreThanAWeekAgo)).toBe(true);
    });

    it("returns false when less than one week has passed", () => {
      const lessThanAWeekAgo = Date.now() - ONE_WEEK + 60000;
      expect(shouldCheckNow(true, "weekly", lessThanAWeekAgo)).toBe(false);
    });
  });
});
