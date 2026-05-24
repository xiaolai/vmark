/**
 * Hot Exit Coordination Tests
 *
 * Tests for coordination between hot exit restore and other startup hooks.
 * Critical: Finder file open must wait for hot exit restore to complete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isRestoreInProgress,
  setRestoreInProgress,
  waitForRestoreComplete,
  notifyRestoreComplete,
  resetCoordinationState,
} from './hotExitCoordination';

describe('hotExitCoordination', () => {
  beforeEach(() => {
    // Reset state before each test
    resetCoordinationState();
  });

  describe('isRestoreInProgress', () => {
    it('should return false initially', () => {
      expect(isRestoreInProgress()).toBe(false);
    });

    it('should return true after setRestoreInProgress(true)', () => {
      setRestoreInProgress(true);
      expect(isRestoreInProgress()).toBe(true);
    });

    it('should return false after setRestoreInProgress(false)', () => {
      setRestoreInProgress(true);
      setRestoreInProgress(false);
      expect(isRestoreInProgress()).toBe(false);
    });
  });

  describe('waitForRestoreComplete', () => {
    it('should resolve immediately if restore is not in progress', async () => {
      setRestoreInProgress(false);
      const start = Date.now();
      await waitForRestoreComplete();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50); // Should be nearly instant
    });

    it('should wait until restore completes', async () => {
      setRestoreInProgress(true);

      // Start waiting
      const waitPromise = waitForRestoreComplete();

      // Simulate restore completing after 100ms
      setTimeout(() => {
        notifyRestoreComplete();
      }, 100);

      const start = Date.now();
      await waitPromise;
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(90);
      expect(elapsed).toBeLessThan(200);
    });

    it('should handle timeout gracefully', async () => {
      setRestoreInProgress(true);

      // Wait with a short timeout
      const result = await waitForRestoreComplete(50);

      // Should have timed out but not throw
      expect(result).toBe(false); // Indicates timeout
    });

    it('should return true when restore completes normally', async () => {
      setRestoreInProgress(true);

      setTimeout(() => {
        notifyRestoreComplete();
      }, 10);

      const result = await waitForRestoreComplete(1000);
      expect(result).toBe(true);
    });
  });

  describe('notifyRestoreComplete', () => {
    it('should clear the restore in progress flag', () => {
      setRestoreInProgress(true);
      notifyRestoreComplete();
      expect(isRestoreInProgress()).toBe(false);
    });

    it('should resolve all pending waiters', async () => {
      setRestoreInProgress(true);

      // Multiple waiters
      const waiter1 = waitForRestoreComplete();
      const waiter2 = waitForRestoreComplete();
      const waiter3 = waitForRestoreComplete();

      setTimeout(() => {
        notifyRestoreComplete();
      }, 10);

      const results = await Promise.all([waiter1, waiter2, waiter3]);
      expect(results).toEqual([true, true, true]);
    });

    it('should be safe to call when no waiters are pending', () => {
      // notifyRestoreComplete with empty pendingWaiters array
      notifyRestoreComplete();
      expect(isRestoreInProgress()).toBe(false);
    });
  });

  describe('waitForRestoreComplete — timeout and idempotency branches', () => {
    it('timeout fires and removes waiter from pending list (lines 60-69)', async () => {
      setRestoreInProgress(true);

      // Use real short timeout to actually hit the timeout callback
      const result = await waitForRestoreComplete(5);
      expect(result).toBe(false);

      // Calling notify after timeout is safe — waiter was already removed
      notifyRestoreComplete();
      expect(isRestoreInProgress()).toBe(false);
    });

    it('timeout callback no-op when already resolved by notify (line 61 false branch)', async () => {
      vi.useFakeTimers();

      setRestoreInProgress(true);

      const resultPromise = waitForRestoreComplete(100);

      // Resolve via notify BEFORE the timeout fires
      notifyRestoreComplete();

      // Flush microtasks so promise resolves
      await vi.advanceTimersByTimeAsync(0);
      const result = await resultPromise;
      expect(result).toBe(true);

      // Now advance past the timeout — callback fires but resolved=true
      // so the if(!resolved) on line 61 takes the false branch
      await vi.advanceTimersByTimeAsync(200);

      vi.useRealTimers();
    });

    it('waiter callback no-op when already resolved by timeout (line 74 false branch)', async () => {
      vi.useFakeTimers();

      setRestoreInProgress(true);

      const resultPromise = waitForRestoreComplete(50);

      // Fire the timeout — this sets resolved=true and removes waiter from array
      await vi.advanceTimersByTimeAsync(60);
      const result = await resultPromise;
      expect(result).toBe(false);

      // Now manually call notifyRestoreComplete — if the waiter were still in the array,
      // the waiterCallback would check `if (!resolved)` and skip. But the timeout
      // already removed it. This is the defensive guard — it can't truly fire in
      // single-threaded JS since the timeout always removes the waiter first.
      notifyRestoreComplete();

      vi.useRealTimers();
    });

    it('setRestoreInProgress(false) also notifies waiters', async () => {
      setRestoreInProgress(true);

      const waiter = waitForRestoreComplete(5000);

      // Setting false triggers notifyRestoreComplete internally
      setRestoreInProgress(false);

      const result = await waiter;
      expect(result).toBe(true);
    });
  });

  describe('notifyRestoreComplete — while loop exhausts all waiters', () => {
    it('resolves five simultaneous waiters in order', async () => {
      setRestoreInProgress(true);

      // Register five waiters — exercises the while(pendingWaiters.length > 0) loop
      // with if(waiter) true on each iteration
      const w1 = waitForRestoreComplete(5000);
      const w2 = waitForRestoreComplete(5000);
      const w3 = waitForRestoreComplete(5000);
      const w4 = waitForRestoreComplete(5000);
      const w5 = waitForRestoreComplete(5000);

      notifyRestoreComplete();

      const results = await Promise.all([w1, w2, w3, w4, w5]);
      expect(results).toEqual([true, true, true, true, true]);
      expect(isRestoreInProgress()).toBe(false);
    });

    it('notifyRestoreComplete with no waiters leaves state clean', () => {
      // Empty pendingWaiters — while condition is false immediately, loop body never runs
      setRestoreInProgress(true);
      notifyRestoreComplete();
      expect(isRestoreInProgress()).toBe(false);
    });
  });
});
