/**
 * Outbound request rate limiting (token bucket).
 *
 * One bucket per bridge, refilled to `maxPerSecond` once a full second has
 * elapsed. The refill deliberately keeps the sub-second remainder
 * (`now - elapsed % 1000`) so a steady stream of requests cannot drift the
 * window forward and earn extra tokens.
 */

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;

  /**
   * @param maxPerSecond Max requests per second; `<= 0` disables limiting.
   */
  constructor(private readonly maxPerSecond: number) {
    this.tokens = maxPerSecond;
    this.lastRefill = Date.now();
  }

  /**
   * Check rate limit and consume a token if available.
   * Returns true if request can proceed, false if rate limited.
   */
  tryConsume(): boolean {
    // Rate limiting disabled
    if (this.maxPerSecond <= 0) {
      return true;
    }

    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // Refill tokens based on elapsed time
    if (elapsed >= 1000) {
      const refillCount = Math.floor(elapsed / 1000) * this.maxPerSecond;
      this.tokens = Math.min(this.maxPerSecond, this.tokens + refillCount);
      this.lastRefill = now - (elapsed % 1000);
    }

    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }

    return false;
  }
}
