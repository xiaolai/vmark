/**
 * resolveBridgeConfig — the pending-request timeout must outlast the Rust
 * bridge's 23 s worst case (write-lock wait + wake-and-retry), or a write the bridge recovered is
 * reported to the AI client as timed out (and may be retried).
 */
import { describe, expect, it } from 'vitest';
import { resolveBridgeConfig } from '../../../src/bridge/websocketConfig.js';

describe('resolveBridgeConfig requestTimeout', () => {
  it('defaults to 25 s', () => {
    expect(resolveBridgeConfig().requestTimeout).toBe(25_000);
  });

  it('accepts a value past the bridge worst case', () => {
    expect(resolveBridgeConfig({ requestTimeout: 23_001 }).requestTimeout).toBe(23_001);
  });

  it.each([23_000, 20_001, 10_000, 100, 1, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, 25_000.5])(
    'refuses %s: not past the 23 s worst case, not a whole number of ms, or not a delay a timer can hold',
    (requestTimeout) => {
      expect(() => resolveBridgeConfig({ requestTimeout })).toThrow(RangeError);
      expect(() => resolveBridgeConfig({ requestTimeout })).toThrow(/requestTimeout/);
    },
  );
});

describe('resolveBridgeConfig maxQueueSize', () => {
  it('defaults to 100', () => {
    expect(resolveBridgeConfig().maxQueueSize).toBe(100);
  });

  it.each([1, 2, 100, 10_000])('accepts the positive integer %s', (maxQueueSize) => {
    expect(resolveBridgeConfig({ maxQueueSize }).maxQueueSize).toBe(maxQueueSize);
  });

  // A NaN cap makes `length >= cap` permanently false, so the queue grows
  // without bound; a fraction or non-positive value is a caller mistake that
  // used to be clamped silently.
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, 0.5, 0, -1, 2 ** 53])(
    'refuses %s: not a finite positive integer',
    (maxQueueSize) => {
      expect(() => resolveBridgeConfig({ maxQueueSize })).toThrow(RangeError);
      expect(() => resolveBridgeConfig({ maxQueueSize })).toThrow(/maxQueueSize/);
    },
  );
});

// Every numeric option is checked where defaults are applied: a NaN rate makes
// the token bucket refuse every request forever, and a NaN, negative or
// oversized delay makes a timer fire at once.
describe('resolveBridgeConfig — every other numeric option', () => {
  it('keeps the documented defaults', () => {
    expect(resolveBridgeConfig()).toMatchObject({
      timeout: 10_000,
      maxReconnectAttempts: 10,
      reconnectDelay: 1_000,
      maxReconnectDelay: 30_000,
      maxRequestsPerSecond: 100,
    });
  });

  it.each([
    [{ port: 1 }],
    [{ port: 65_535 }],
    [{ timeout: 1 }],
    [{ maxReconnectAttempts: 0 }],
    [{ reconnectDelay: 5, maxReconnectDelay: 5 }],
    [{ maxRequestsPerSecond: 0 }],
    [{ maxRequestsPerSecond: 0.5 }],
  ])('accepts %j', (config) => {
    expect(resolveBridgeConfig(config)).toMatchObject(config);
  });

  const NOT_A_DELAY = [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 2 ** 31, 1.5, 999.9];
  it.each([
    ...[0, 65_536, 1.5, Number.NaN].map((port) => ['port', { port }] as const),
    ...NOT_A_DELAY.map((timeout) => ['timeout', { timeout }] as const),
    ...[-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map((n) => ['maxReconnectAttempts', { maxReconnectAttempts: n }] as const),
    ...NOT_A_DELAY.map((reconnectDelay) => ['reconnectDelay', { reconnectDelay }] as const),
    ...NOT_A_DELAY.map((maxReconnectDelay) => ['maxReconnectDelay', { maxReconnectDelay }] as const),
    ['maxReconnectDelay', { reconnectDelay: 2_000, maxReconnectDelay: 1_000 }] as const,
    ['maxReconnectDelay', { maxReconnectDelay: 30_000.5 }] as const,
    ...[-1, Number.NaN, Number.POSITIVE_INFINITY].map((n) => ['maxRequestsPerSecond', { maxRequestsPerSecond: n }] as const),
  ])('refuses a bad %s: %j', (field, config) => {
    expect(() => resolveBridgeConfig(config)).toThrow(RangeError);
    expect(() => resolveBridgeConfig(config)).toThrow(new RegExp(field));
  });
});
