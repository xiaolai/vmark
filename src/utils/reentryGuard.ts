/**
 * Per-Window Re-Entry Guards
 *
 * Purpose: Prevents concurrent execution of async operations within the same window,
 * while allowing independent operations across different windows.
 *
 * Key decisions:
 *   - Per-window keying (windowLabel:operation) because module-level guards would
 *     block all windows when one shows a dialog (e.g., save confirmation)
 *   - withReentryGuard returns undefined (not throws) when locked — callers
 *     can silently skip rather than catching errors
 *   - try/finally ensures locks are always released even on error
 *
 * @coordinates-with closeDecision.ts — uses withReentryGuard for close confirmations
 * @coordinates-with saveToPath.ts — uses withReentryGuard for concurrent save prevention
 * @module utils/reentryGuard
 */

type GuardKey = string;

const guards = new Map<GuardKey, Set<string>>();

function getGuardKey(windowLabel: string, operation: string): GuardKey {
  return `${windowLabel}:${operation}`;
}

/**
 * Check if an operation is already in progress for a window.
 */
export function isOperationInProgress(windowLabel: string, operation: string): boolean {
  const key = getGuardKey(windowLabel, operation);
  return guards.has(key);
}

/**
 * Try to acquire a lock for an operation. Returns true if acquired, false if already locked.
 */
export function tryAcquireLock(windowLabel: string, operation: string): boolean {
  const key = getGuardKey(windowLabel, operation);
  if (guards.has(key)) {
    return false;
  }
  guards.set(key, new Set());
  return true;
}

/**
 * Release a lock for an operation.
 */
export function releaseLock(windowLabel: string, operation: string): void {
  const key = getGuardKey(windowLabel, operation);
  guards.delete(key);
}

/**
 * Execute an async operation with automatic re-entry guard.
 * Returns undefined if the operation is already in progress.
 */
export async function withReentryGuard<T>(
  windowLabel: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  if (!tryAcquireLock(windowLabel, operation)) {
    return undefined;
  }
  try {
    return await fn();
  } finally {
    releaseLock(windowLabel, operation);
  }
}
