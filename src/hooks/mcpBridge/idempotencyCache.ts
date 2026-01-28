/**
 * Idempotency Cache
 *
 * Provides request deduplication with TTL-based expiration.
 * Caches responses by requestId to ensure identical requests
 * return the same result without re-executing.
 *
 * TTL: 5 minutes
 * Max entries: 1000
 * Cleanup interval: 1 minute
 */

import type { McpResponse } from "./types";

interface CacheEntry {
  response: McpResponse;
  expiresAt: number;
}

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of entries in cache */
const MAX_CACHE_SIZE = 1000;

/** Cleanup interval in milliseconds (1 minute) */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * Idempotency cache for MCP request deduplication.
 */
class IdempotencyCache {
  private cache: Map<string, CacheEntry> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Store a response for a request ID.
   * @param requestId Unique request identifier
   * @param response The response to cache
   * @param ttl Optional custom TTL in milliseconds
   */
  set(requestId: string, response: McpResponse, ttl: number = CACHE_TTL_MS): void {
    // Enforce max size by removing oldest entries if needed
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    this.cache.set(requestId, {
      response,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Get a cached response by request ID.
   * @param requestId Unique request identifier
   * @returns Cached response or undefined if not found/expired
   */
  get(requestId: string): McpResponse | undefined {
    const entry = this.cache.get(requestId);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(requestId);
      return undefined;
    }

    return entry.response;
  }

  /**
   * Check if a request ID exists in cache (and not expired).
   */
  has(requestId: string): boolean {
    const response = this.get(requestId);
    return response !== undefined;
  }

  /**
   * Remove expired entries from cache.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all entries from cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current cache size.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Stop the cleanup timer (for testing or shutdown).
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Start the cleanup timer.
   */
  startCleanupTimer(): void {
    if (this.cleanupTimer) {
      return; // Already running
    }
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Evict the oldest entries when cache is full.
   * Removes 10% of entries to make room.
   */
  private evictOldest(): void {
    const entries = Array.from(this.cache.entries());
    // Sort by expiration time (oldest first)
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);

    // Remove 10% of entries
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
  }
}

// Singleton instance
export const idempotencyCache = new IdempotencyCache();

// Export class for testing
export { IdempotencyCache };
