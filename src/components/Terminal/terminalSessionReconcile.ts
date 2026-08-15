/**
 * terminalSessionReconcile — the pure part of "which sessions changed".
 *
 * `useTerminalSessions`'s init effect subscribes to the terminal store and
 * reconciles the live xterm instances against it. That reconciliation was inline
 * in a 61-line effect, and no test reached it: `TerminalPanel.test.tsx` mocks the
 * hook wholesale, so session add, removal and active-switch were all unverified
 * (audit 20260815-163607 #20). The diff itself has no React or xterm in it, so
 * it belongs here where it can be tested directly.
 *
 * @coordinates-with useTerminalSessions.ts — sole consumer
 * @module components/Terminal/terminalSessionReconcile
 */

export interface SessionIdDiff {
  /** Store ids with no live instance yet. */
  added: string[];
  /** Ids whose instance outlived its store entry. */
  removed: string[];
}

/**
 * Which session ids appeared and which disappeared between two store reads.
 *
 * @param prevIds     ids seen on the previous notification
 * @param currentIds  ids in the store now
 * @param hasInstance whether an id already has a live xterm instance — an id can
 *                    be new to the STORE snapshot while already constructed (a
 *                    hot-exit restore builds instances before the first
 *                    subscription fires), and constructing it twice would leak
 *                    the first one.
 */
export function diffSessionIds(
  prevIds: ReadonlySet<string>,
  currentIds: ReadonlySet<string>,
  hasInstance: (id: string) => boolean,
): SessionIdDiff {
  const added: string[] = [];
  for (const id of currentIds) {
    if (!prevIds.has(id) && !hasInstance(id)) added.push(id);
  }
  const removed: string[] = [];
  for (const id of prevIds) {
    if (!currentIds.has(id)) removed.push(id);
  }
  return { added, removed };
}
