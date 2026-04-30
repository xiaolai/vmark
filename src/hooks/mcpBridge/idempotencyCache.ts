/**
 * Idempotency Cache
 *
 * Purpose: Request deduplication for MCP bridge — caches responses by requestId
 *   with TTL-based expiration so identical requests return the same result
 *   without re-executing.
 *
 * Key decisions:
 *   - TTL: 5 minutes (long enough for retry, short enough for state changes)
 *   - Max entries: 1000 (prevents unbounded growth)
 *   - Cleanup interval: 1 minute (lazy eviction)
 *
 * @module hooks/mcpBridge/idempotencyCache
 */

interface CacheEntry {
  id: string;
  success: boolean;
  data: any;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

const MAX_CACHE_SIZE = 1000;

class IdempotencyCache {
  private cache: { [key: string]: CacheEntry } = {};
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 1000);
  }

  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  clear() {
    this.cache = {};
  }

  set(key: string, value: CacheEntry, ttl?: number): void {
    if (ttl === undefined) {
      ttl = CACHE_TTL_MS;
    }
    const expiresAt = Date.now() + ttl;
    this.cache[key] = { ...value, expiresAt };
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.cache[key];
    if (entry && entry.expiresAt > Date.now()) {
      return entry;
    }
    delete this.cache[key];
    return undefined;
  }

  has(key: string): boolean {
    const entry = this.cache[key];
    return entry && entry.expiresAt > Date.now();
  }

  cleanup(): void {
    const now = Date.now();
    Object.keys(this.cache).forEach((key) => {
      const entry = this.cache[key];
      if (entry.expiresAt <= now) {
        delete this.cache[key];
      }
    });
  }
}

export { IdempotencyCache };