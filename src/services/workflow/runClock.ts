/**
 * Run clock (audit 2026-09-03 W-06 / D1v2) — the workflow run's deadline.
 *
 * D1v2: "wall-clock deadline 120 s (approval wait time EXCLUDED — the deadline
 * clock pauses while a prompt is open)". The first implementation read a fixed
 * `deadlineAt` inside the approval poll and nowhere else — the inverse: only the
 * wait the user was in control of was bounded, and a run could sit in navigation
 * waits and retries forever. This clock counts RUNNING time only: the executor
 * pauses it from `requestApproval` until the prompt resolves or is withdrawn,
 * and everything else — steps, retries, navigation waits — is on the clock. The
 * step guard checks it before every attempt, and every wait checks it inside.
 *
 * `now` is injected so tests drive it; a budget that is not a finite non-negative
 * number is refused (NaN would make `expired()` false forever).
 *
 * @coordinates-with services/workflow/runApproval.ts — pauses around a prompt
 * @coordinates-with services/workflow/runStepGuard.ts — checks before every attempt
 * @module services/workflow/runClock
 */

export interface RunClock {
  /** Running time consumed so far (ms). */
  elapsed(): number;
  /** Running time left before the deadline (ms, never negative). */
  remaining(): number;
  /** Whether the running-time budget is spent. */
  expired(): boolean;
  /** Stop counting (a prompt is open). Idempotent. */
  pause(): void;
  /** Start counting again. Idempotent. */
  resume(): void;
  /** Whether the clock is currently paused. */
  readonly paused: boolean;
}

/** Monotonic where the platform offers it: a wall-clock rollback must not extend
 *  the budget, nor a forward adjustment expire it early. */
const monotonicNow: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : Date.now;

export function createRunClock(budgetMs: number, now: () => number = monotonicNow): RunClock {
  if (!Number.isFinite(budgetMs) || budgetMs < 0) {
    throw new RangeError(`run budget must be a finite non-negative number of ms (got ${budgetMs})`);
  }
  let consumed = 0;
  let runningSince: number | null = now();

  const elapsed = (): number => consumed + (runningSince === null ? 0 : now() - runningSince);

  return {
    elapsed,
    remaining: () => Math.max(0, budgetMs - elapsed()),
    expired: () => elapsed() >= budgetMs,
    pause: () => {
      if (runningSince === null) return;
      consumed += now() - runningSince;
      runningSince = null;
    },
    resume: () => {
      if (runningSince !== null) return;
      runningSince = now();
    },
    get paused() {
      return runningSince === null;
    },
  };
}
