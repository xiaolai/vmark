/**
 * Purpose: serialize async work per file path, so two writes to one file can
 * never interleave or complete out of order.
 *
 * Key decisions:
 *   - Ordering, not mutual exclusion. Tasks for one path run in the order they
 *     were submitted; tasks for different paths run concurrently. Saving two
 *     documents at once must not become sequential.
 *   - The chain survives a failing task. A rejected save must not wedge every
 *     later save to that file, so the successor runs whether its predecessor
 *     resolved or rejected.
 *   - The map self-prunes. A long session touches thousands of paths; holding
 *     a settled promise per path forever is a leak. The entry is removed once
 *     it settles, unless a successor has already replaced it.
 *   - Keys are caller-normalized. This module does not know what a path means
 *     on the host platform; `saveToPath` normalizes before calling so that
 *     `/a/./b.md` and `/a/b.md` land on one chain.
 *
 * @coordinates-with services/persistence/saveToPath.ts — the production caller
 * @module services/persistence/serializeByPath
 */

/** In-flight tail per key. Present only while work is pending for that key. */
const chains = new Map<string, Promise<void>>();

/**
 * Run `task` after any previously submitted task for `key` has settled.
 *
 * Returns the task's own promise, so callers see its result and its errors
 * unchanged — the serializer is invisible except for the wait.
 */
export function serializeByPath<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();

  // Same continuation on both settle paths: a predecessor's failure delays its
  // successor, it does not cancel it.
  const run = previous.then(task, task);

  // The tail is the SETTLED shape — a successor waits for completion, not for
  // success, and must not inherit an unhandled rejection.
  const tail = run.then(
    () => {},
    () => {}
  );
  chains.set(key, tail);

  void tail.then(() => {
    // Only prune our own entry; a later submission has already replaced it.
    if (chains.get(key) === tail) chains.delete(key);
  });

  return run;
}

/** Number of paths with work outstanding. Test/diagnostic use. */
export function pendingPathCount(): number {
  return chains.size;
}

/** Drop all chains. Tests only — production has no reason to forget ordering. */
export function __resetSerializer(): void {
  chains.clear();
}
