/**
 * Resilience state machine — T07.
 *
 * Models the lifecycle of document persistence/recovery operations.
 * States are advisory: they enable reentry guards and document the
 * sequence the implementation should preserve.
 *
 * State transitions:
 *
 *   idle ───(mount)──► restoring ───(restore complete)──► ready
 *                          │                                │
 *                          └───(no-op / cleanup)────────────┘
 *                                                           │
 *                                                           ▼
 *                                                    snapshotting
 *                                                           │
 *                                                           ▼
 *                                                       (ready)
 *                                                           │
 *                                          (unmount / final save)
 *                                                           │
 *                                                           ▼
 *                                                       cleaning
 *                                                           │
 *                                                           ▼
 *                                                         idle
 *
 * @module services/persistence/resilience/machine
 */

export type ResilienceState =
  | "idle"
  | "restoring"
  | "ready"
  | "snapshotting"
  | "cleaning";

const ALLOWED_TRANSITIONS: Record<ResilienceState, ResilienceState[]> = {
  idle: ["restoring", "ready"],
  restoring: ["ready", "cleaning"],
  ready: ["snapshotting", "cleaning"],
  snapshotting: ["ready"],
  cleaning: ["idle"],
};

export function isLegalTransition(from: ResilienceState, to: ResilienceState): boolean {
  if (from === to) return true; // re-entry is a no-op, not a failure
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface ResilienceMachine {
  readonly state: ResilienceState;
  /** Attempt a transition; returns true if legal (and applied), false if rejected. */
  transition(next: ResilienceState): boolean;
}

export function createResilienceMachine(initial: ResilienceState = "idle"): ResilienceMachine {
  let state: ResilienceState = initial;
  return {
    get state() {
      return state;
    },
    transition(next: ResilienceState) {
      if (!isLegalTransition(state, next)) return false;
      state = next;
      return true;
    },
  };
}
