/**
 * Tests for idempotencyCache
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IdempotencyCache } from "../idempotencyCache";

describe("IdempotencyCache", () => {
  let cache: IdempotencyCache;

  beforeEach(() => {
    cache = new IdempotencyCache();
    cache.stopCleanupTimer(); // Disable auto-cleanup for tests
  });

  afterEach(() => {
    cache.stopCleanupTimer();
    cache.clear();
  });

  describe("set and get", () => {
    it("stores and retrieves responses", () => {
      const response = { id: "req-1", success: true, data: "test" };
      cache.set("req-1", response);

      expect(cache.get("req-1")).toEqual(response);
    });

    it("returns undefined for non-existent keys", () => {
      expect(cache.get("non-existent")).toBeUndefined();
    });
  });

  describe("expiration", () => {
    it("returns undefined for expired entries", () => {
      vi.useFakeTimers();

      const response = { id: "req-1", success: true, data: "test" };
      cache.set("req-1", response, 1000); // 1 second TTL

      expect(cache.get("req-1")).toEqual(response);

      vi.advanceTimersByTime(1500); // Advance past TTL

      expect(cache.get("req-1")).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe("has", () => {
    it("returns true for valid entries", () => {
      cache.set("req-1", { id: "req-1", success: true });
      expect(cache.has("req-1")).toBe(true);
    });

    it("returns false for missing entries", () => {
      expect(cache.has("missing")).toBe(false);
    });

    it("returns false for expired entries", () => {
      vi.useFakeTimers();

      cache.set("req-1", { id: "req-1", success: true }, 1000);
      vi.advanceTimersByTime(1500);

      expect(cache.has("req-1")).toBe(false);

      vi.useRealTimers();
    });
  });

  describe("cleanup", () => {
    it("removes expired entries", () => {
      vi.useFakeTimers();

      cache.set("req-1", { id: "req-1", success: true }, 1000);
      cache.set("req-2", { id: "req-2", success: true }, 5000);

      vi.advanceTimersByTime(2000);
      cache.cleanup();

      expect(cache.has("req-1")).toBe(false);
      expect(cache.has("req-2")).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("size limits", () => {
    it("evicts oldest entries when max size reached", () => {
      // Fill cache to max size
      for (let i = 0; i < 1001; i++) {
        cache.set(`req-${i}`, { id: `req-${i}`, success: true });
      }

      // Should have evicted some entries
      expect(cache.size()).toBeLessThanOrEqual(1000);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      cache.set("req-1", { id: "req-1", success: true });
      cache.set("req-2", { id: "req-2", success: true });

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has("req-1")).toBe(false);
      expect(cache.has("req-2")).toBe(false);
    });
  });

  describe("idempotency behavior", () => {
    it("returns cached response for duplicate requests", () => {
      const response1 = { id: "req-1", success: true, data: { value: 1 } };
      cache.set("req-1", response1);

      // Simulate duplicate request
      const response2 = cache.get("req-1");

      expect(response2).toEqual(response1);
    });
  });
});
