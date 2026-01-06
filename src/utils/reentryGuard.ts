/**
 * Per-window re-entry guards for async operations.
 *
 * In multi-window apps, module-level guards prevent concurrent operations
 * across ALL windows (one dialog blocks all windows). Per-window guards
 * allow each window to have its own independent lock.
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
