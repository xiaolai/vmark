// @vitest-environment node
/**
 * Tests for date utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatRelativeTime,
  formatExactTime,
  formatSnapshotTime,
  groupByDay,
} from "./dateUtils";

describe("dateUtils", () => {
  describe("formatRelativeTime", () => {
    let nowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      const fixedNow = 1700000000000; // Fixed timestamp
      nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    });

    afterEach(() => {
      nowSpy.mockRestore();
    });

    it('returns "just now" for < 5 seconds ago', () => {
      const timestamp = Date.now() - 2000; // 2 seconds ago
      expect(formatRelativeTime(timestamp)).toBe("just now");
    });

    it("returns seconds ago for < 60 seconds", () => {
      const timestamp = Date.now() - 30000; // 30 seconds ago
      expect(formatRelativeTime(timestamp)).toBe("30s ago");
    });

    it("returns minutes ago for < 60 minutes", () => {
      const timestamp = Date.now() - 300000; // 5 minutes ago
      expect(formatRelativeTime(timestamp)).toBe("5m ago");
    });

    it("returns hours ago for >= 60 minutes", () => {
      const timestamp = Date.now() - 7200000; // 2 hours ago
      expect(formatRelativeTime(timestamp)).toBe("2h ago");
    });

    it("handles boundary at 59 seconds", () => {
      const timestamp = Date.now() - 59000; // 59 seconds ago
      expect(formatRelativeTime(timestamp)).toBe("59s ago");
    });

    it("handles boundary at 60 seconds", () => {
      const timestamp = Date.now() - 60000; // 60 seconds = 1 minute ago
      expect(formatRelativeTime(timestamp)).toBe("1m ago");
    });

    it("handles boundary at 59 minutes", () => {
      const timestamp = Date.now() - 59 * 60 * 1000; // 59 minutes ago
      expect(formatRelativeTime(timestamp)).toBe("59m ago");
    });

    it("handles boundary at 60 minutes", () => {
      const timestamp = Date.now() - 60 * 60 * 1000; // 60 minutes = 1 hour ago
      expect(formatRelativeTime(timestamp)).toBe("1h ago");
    });
  });

  describe("formatExactTime", () => {
    it("returns a formatted time string", () => {
      const timestamp = Date.now();
      const result = formatExactTime(timestamp);
      // Should be a valid time string (locale-dependent)
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("formats different timestamps differently", () => {
      const morning = new Date();
      morning.setHours(9, 30, 0);
      const evening = new Date();
      evening.setHours(21, 30, 0);

      const morningTime = formatExactTime(morning.getTime());
      const eveningTime = formatExactTime(evening.getTime());

      // They should be different
      expect(morningTime).not.toBe(eveningTime);
    });
  });

  describe("formatSnapshotTime", () => {
    it("includes 'Today' for today's timestamps", () => {
      const now = Date.now();
      const result = formatSnapshotTime(now);
      expect(result).toContain("Today");
    });

    it("includes 'Yesterday' for yesterday's timestamps", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const result = formatSnapshotTime(yesterday.getTime());
      expect(result).toContain("Yesterday");
    });

    it("includes date for older timestamps", () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const result = formatSnapshotTime(weekAgo.getTime());
      // Should not contain Today or Yesterday
      expect(result).not.toContain("Today");
      expect(result).not.toContain("Yesterday");
      // Should contain some date info
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("groupByDay", () => {
    interface TestItem {
      id: number;
      timestamp: number;
    }

    it("groups items by day", () => {
      const now = Date.now();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const items: TestItem[] = [
        { id: 1, timestamp: now },
        { id: 2, timestamp: now - 1000 },
        { id: 3, timestamp: yesterday.getTime() },
      ];

      const groups = groupByDay(items, (item) => item.timestamp);

      expect(groups.has("Today")).toBe(true);
      expect(groups.has("Yesterday")).toBe(true);
      expect(groups.get("Today")?.length).toBe(2);
      expect(groups.get("Yesterday")?.length).toBe(1);
    });

    it("handles empty array", () => {
      const groups = groupByDay<TestItem>([], (item) => item.timestamp);
      expect(groups.size).toBe(0);
    });

    it("handles single item", () => {
      const items: TestItem[] = [{ id: 1, timestamp: Date.now() }];
      const groups = groupByDay(items, (item) => item.timestamp);
      expect(groups.size).toBe(1);
      expect(groups.has("Today")).toBe(true);
    });

    it("groups items from 5 days ago under a date label (not Today/Yesterday)", () => {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const items: TestItem[] = [{ id: 1, timestamp: fiveDaysAgo.getTime() }];
      const groups = groupByDay(items, (item) => item.timestamp);

      expect(groups.size).toBe(1);
      // The key should NOT be "Today" or "Yesterday"
      const key = [...groups.keys()][0];
      expect(key).not.toBe("Today");
      expect(key).not.toBe("Yesterday");
      // Should contain a weekday name (from toLocaleDateString with weekday: "long")
      expect(key.length).toBeGreaterThan(0);
    });

    it("preserves item order within groups", () => {
      const now = Date.now();
      const items: TestItem[] = [
        { id: 1, timestamp: now },
        { id: 2, timestamp: now - 1000 },
        { id: 3, timestamp: now - 2000 },
      ];

      const groups = groupByDay(items, (item) => item.timestamp);
      const todayItems = groups.get("Today")!;

      expect(todayItems[0].id).toBe(1);
      expect(todayItems[1].id).toBe(2);
      expect(todayItems[2].id).toBe(3);
    });
  });
});
