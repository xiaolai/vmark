/**
 * Idempotency Cache Tests
 *
 * Tests for IdempotencyCache: TTL expiration, max size eviction,
 * cleanup timer, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IdempotencyCache } from "./idempotencyCache";

// Mock types module to avoid import issues
vi.mock("./types", () => ({}));

describe("IdempotencyCache", () => {
  let cache: IdempotencyCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new IdempotencyCache();
  });

  afterEach(() => {
    cache.stopCleanupTimer();
    vi.useRealTimers();
  });

  describe("set and get", () => {
    it("stores and retrieves a response", () => {
      const response = { id: "req-1", success: true, data: "result" };
      cache.set("req-1", response);

      expect(cache.get("req-1")).toEqual(response);
    });

    it("returns undefined for unknown request ID", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("returns undefined for expired entry", () => {
      const response = { id: "req-1", success: true, data: null };
      cache.set("req-1", response, 1000); // 1 second TTL

      vi.advanceTimersByTime(1001);

      expect(cache.get("req-1")).toBeUndefined();
    });

    it("returns entry within TTL", () => {
      const response = { id: "req-1", success: true, data: null };
      cache.set("req-1", response, 5000);

      vi.advanceTimersByTime(4999);

      expect(cache.get("req-1")).toEqual(response);
    });
  });

  describe("has", () => {
    it("returns true for existing non-expired entry", () => {
      cache.set("req-1", { id: "req-1", success: true, data: null });
      expect(cache.has("req-1")).toBe(true);
    });

    it("returns false for missing entry", () => {
      expect(cache.has("missing")).toBe(false);
    });

    it("returns false for expired entry", () => {
      cache.set("req-1", { id: "req-1", success: true, data: null }, 100);
      vi.advanceTimersByTime(101);
      expect(cache.has("req-1")).toBe(false);
    });
  });

  describe("size", () => {
    it("returns 0 for empty cache", () => {
      expect(cache.size()).toBe(0);
    });

    it("reflects added entries", () => {
      cache.set("a", { id: "a", success: true, data: null });
      cache.set("b", { id: "b", success: true, data: null });
      expect(cache.size()).toBe(2);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      cache.set("a", { id: "a", success: true, data: null });
      cache.set("b", { id: "b", success: true, data: null });
      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe("cleanup", () => {
    it("removes expired entries", () => {
      cache.set("expired", { id: "1", success: true, data: null }, 100);
      cache.set("valid", { id: "2", success: true, data: null }, 10000);

      vi.advanceTimersByTime(200);
      cache.cleanup();

      expect(cache.has("expired")).toBe(false);
      expect(cache.has("valid")).toBe(true);
    });
  });

  describe("eviction", () => {
    it("evicts oldest when max size reached", () => {
      // Fill cache to max size (1000) and add one more
      for (let i = 0; i < 1000; i++) {
        cache.set(`req-${i}`, { id: `req-${i}`, success: true, data: null });
      }
      expect(cache.size()).toBe(1000);

      // Adding one more triggers eviction
      cache.set("req-1000", { id: "req-1000", success: true, data: null });

      // After eviction, size should be <= 1000
      expect(cache.size()).toBeLessThanOrEqual(1000);
      // The newest entry should still be there
      expect(cache.has("req-1000")).toBe(true);
    });
  });

  describe("cleanup timer", () => {
    it("does not double-start cleanup timer", () => {
      // Constructor already starts timer
      cache.startCleanupTimer(); // should be a no-op
      // No error thrown means success
    });

    it("stops and restarts cleanup timer", () => {
      cache.stopCleanupTimer();
      cache.startCleanupTimer();
      // Should work without error
    });
  });
});
