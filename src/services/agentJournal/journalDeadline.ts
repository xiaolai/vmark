/**
 * Journal deadline — bound a journal call, so a journal that never answers
 * cannot hold a save or a journaled mutation open. Past the deadline the
 * call refuses `JOURNAL_TIMEOUT`: a save reports itself not recorded, and
 * a mutation refuses or settles not durable (`controlledMutation.ts`).
 *
 * The time budget of one journaled mutation, which must answer inside the
 * MCP bridge's 20 s total (twice `REQUEST_TIMEOUT`,
 * `src-tauri/src/mcp_bridge/state.rs`): the pre-apply budget, then the
 * effects deadline (`journaledMutation.ts`), then one commit call — 7 000 +
 * 5 000 + 5 000 ms, leaving 3 000 ms for the apply, timer delay and the
 * response. `scripts/check-journal-time-budget.test.mjs` fails when either
 * side changes without the other.
 *
 * Key decisions:
 *   - The clock starts when the call is made, before any of its own work,
 *     so the time charged includes what the client and the libraries it
 *     uses do (hashing with `crypto.subtle`, encoding), not only the wait
 *     for the reply.
 *   - Work that never yields cannot be preempted, so it is charged when the
 *     call settles: an answer that lands after the deadline by the wall
 *     clock is refused even when it beat the timer. That covers the
 *     library's own dispatch and continuation work — synchronous work in
 *     the call, a queued continuation, the callback that settles it — which
 *     blocks the timer as long as it blocks everything else. A stall that
 *     was not the library's is charged too: that errs late, never in time.
 *   - The call itself is not cancelled. A reply arriving late is dropped by
 *     the caller, which keeps its own chain ordered (see `saveJournal.ts`),
 *     or handed to `onLate`, so a late prepare can be aborted.
 *   - The pre-apply budget starts before the freeze payload and covers
 *     everything before the apply: each prepare attempt runs under the
 *     smaller of the per-call deadline and what remains of it.
 *
 * @module services/agentJournal/journalDeadline
 */

import { JournalRefusal, toJournalRefusal } from "./journalRefusal";

/** How long one journal call may take before it refuses `JOURNAL_TIMEOUT`. */
export const JOURNAL_DEADLINE_MS = 5000;

/** How long a journaled mutation may take from its start to the apply (see the header). */
export const JOURNAL_PREAPPLY_BUDGET_MS = 7000;

/** A running time budget: the milliseconds left (zero or less once spent). */
export interface JournalBudget {
  remaining(): number;
}

/** Start a budget of `ms` now. */
export function startJournalBudget(ms = JOURNAL_PREAPPLY_BUDGET_MS): JournalBudget {
  const ends = performance.now() + ms;
  return { remaining: () => ends - performance.now() };
}

/** The refusal of a journal call that did not answer `what` within `ms`. */
export function journalTimeout(what: string, ms: number): JournalRefusal {
  return new JournalRefusal("JOURNAL_TIMEOUT", `the agent edit journal did not answer ${what} within ${Math.max(0, Math.round(ms))} ms`);
}

/**
 * `running`'s value, or `null` once `ms` passes without it settling — by
 * the timer, or by the monotonic clock when the value lands late but before
 * the timer could fire (see the header). Its rejection passes through
 * unchanged.
 */
export function settleWithin<T>(running: Promise<T>, ms: number): Promise<{ value: T } | null> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
  });
  const settled = running.then((value) => (performance.now() - started > ms ? null : { value }));
  return Promise.race([settled, expired]).finally(() => clearTimeout(timer));
}

/**
 * Run `call` under the deadline; rejects with a `JournalRefusal`. A value
 * that arrives after the deadline is handed to `onLate`, never resolved.
 */
export function withJournalDeadline<T>(
  what: string,
  call: () => Promise<T>,
  ms = JOURNAL_DEADLINE_MS,
  onLate?: (value: T) => void,
): Promise<T> {
  const timeout = () => journalTimeout(what, ms);
  return new Promise<T>((resolve, reject) => {
    const started = performance.now();
    let expired = false;
    const late = () => expired || performance.now() - started > ms;
    const timer = setTimeout(() => {
      expired = true;
      reject(timeout());
    }, ms);
    let running: Promise<T>;
    try {
      running = call();
    } catch (error) {
      running = Promise.reject(toJournalRefusal(error));
    }
    running.then(
      (value) => {
        clearTimeout(timer);
        if (!late()) return resolve(value);
        reject(timeout());
        onLate?.(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(late() ? timeout() : toJournalRefusal(error));
      },
    );
  });
}
