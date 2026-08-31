/**
 * Per-instance operation lock (audit 20260831 round 2, R2-14).
 *
 * Purpose: ONE mutual-exclusion set for every long-running workspace-instance
 * operation — close, move, duplicate. Each of these crosses an await (a dirty
 * prompt, a transfer ack) during which the others can be activated from the
 * rail; running two against the same instance concurrently serializes a
 * payload from a source mid-mutation or removes an instance another operation
 * is still reading.
 *
 * Key decision: close and move/duplicate previously held SEPARATE sets
 * (`closing` in closeWorkspaceInstance, `transferring` in
 * workspaceWindowActions), which excluded close-vs-close and move-vs-move but
 * let a close start during a move's ack wait. One set closes the class.
 *
 * The lock is advisory and webview-local — the same trust boundary the two
 * sets it replaces had. It is not a cross-window mutex.
 *
 * @coordinates-with closeWorkspaceInstance.ts — close leg
 * @coordinates-with workspaceWindowActions.ts — move/duplicate legs
 * @module services/workspaces/instanceOperationLock
 */

const inFlight = new Set<string>();

/**
 * Try to take the instance's operation slot. Returns false when another
 * close/move/duplicate already holds it — the caller reports `busy`.
 * A successful acquire MUST be paired with releaseInstanceOperation in a
 * `finally`.
 */
export function acquireInstanceOperation(workspaceInstanceId: string): boolean {
  if (inFlight.has(workspaceInstanceId)) return false;
  inFlight.add(workspaceInstanceId);
  return true;
}

export function releaseInstanceOperation(workspaceInstanceId: string): void {
  inFlight.delete(workspaceInstanceId);
}

/** Test-only: drop all held locks so suites stay isolated. */
export function resetInstanceOperationLocks(): void {
  inFlight.clear();
}
