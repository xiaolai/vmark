/**
 * Web workflow execution engine (WI-4.2 / R8/R8a/R11).
 *
 *
 * ⚠️ **NOT WIRED. The entire web-workflow engine has no production entry point.** Nothing
 * outside tests calls `runWorkflow`/`runWebWorkflow`, and the MCP bridge does not reach it.
 * So the R8a write-safety gate, the R11 lease coupling, and the retry/self-heal paths below
 * do not run in the product. **In particular: this engine re-executes recorded steps without
 * a fresh per-attempt approval gate — which would be a serious authorization flaw if it were
 * live, and must be built BEFORE it is wired.** An approval is for one action, once; replay
 * must not launder it into standing automation. Treat everything here as an unfinished spec,
 * not a deployed guarantee. (Branch audit.)
 *
 * Purpose: run a parsed workflow's steps in order against an injected executor
 * (the driver in production, a mock in tests), applying the write-safety
 * decision core (safety.ts) after each step: a step completes, retries (bounded),
 * pauses for a human, or fails. The load-bearing safety rules come straight from
 * `decideAfterResult` — an UNKNOWN outcome never auto-retries, a failed write is
 * only retried when its postcondition confirms it did not apply, and a
 * confirmed-applied write is an idempotent success. The engine adds the retry
 * bound, the human-gate rule (a non-retryable step is never re-run), and the R11
 * lease check — re-evaluated before every attempt, so a lease lost mid-step cannot
 * be followed by a retry that acts on a page the AI no longer owns. A thrown
 * executor becomes an UNKNOWN outcome (pause), never an escaped exception.
 *
 * Pure orchestration: no I/O of its own. The executor performs the tiered
 * driver/agent work and returns the three-valued outcome + optional postcondition
 * result; escalation between tiers is the executor's concern (it decides how to
 * run a given step), while this engine owns the safety/retry/pause control flow.
 *
 * @coordinates-with lib/browser/workflow/safety.ts — the R8a decision core
 * @coordinates-with services/browser/lease.ts — the R11 automation lease
 * @module lib/browser/workflow/engine
 */

import { decideAfterResult, type StepOutcome } from "./safety";

/** A step the engine drives. `write` marks a mutating (publish/submit) step. */
export interface EngineStep {
  readonly id: string;
  readonly write: boolean;
  /** Whether a retryable failure may be re-executed automatically (default true).
   *  `false` for a human gate (`confirm`): re-running it means re-asking a human who
   *  already answered, so the run pauses instead (plan WI-4.2 — "confirm blocks"). */
  readonly retryable?: boolean;
}

/** Runs one step and returns its three-valued outcome (+ postcondition). */
export type StepExecutor = (step: EngineStep, index: number) => Promise<StepOutcome>;

export interface RunOptions {
  /** Per-step retry cap for retryable failures (default 2). Must be a non-negative integer. */
  maxRetries?: number;
  /** R11 — return false once the automation lease is lost; the run pauses. */
  leaseHeld?: () => boolean;
}

/** Stable, language-independent stop code. `reason` is the developer-facing English
 *  detail (for logs/tests); the UI localizes by `reasonCode` — the same convention the
 *  parser uses for its diagnostics, so no `t()` leaks into this pure layer. */
export type RunStopCode = "lease-lost" | "needs-human" | "retries-exhausted";

export interface WorkflowRunResult {
  status: "completed" | "paused" | "failed";
  /** Steps that completed successfully before the run ended. */
  completedSteps: number;
  /** The step id where the run paused or failed, if it did not complete. */
  pausedAt?: string;
  /** Stable code for a pause/failure — localize by this, not by `reason`. */
  reasonCode?: RunStopCode;
  /** Developer-facing English detail for a pause/failure. */
  reason?: string;
}

/** Why a step ended the run. `null` = the step completed and the run goes on. */
interface StepStop {
  status: "paused" | "failed";
  reasonCode: RunStopCode;
  reason: string;
}

const LEASE_LOST: StepStop = {
  status: "paused",
  reasonCode: "lease-lost",
  reason: "automation lease lost — a human took control",
};

function needsHuman(step: EngineStep, detail: string): StepStop {
  return {
    status: "paused",
    reasonCode: "needs-human",
    reason: `step '${step.id}' needs a human decision (${detail})`,
  };
}

/** Validate the retry cap up front. `NaN` never trips `attempts > maxRetries` and
 *  `Infinity` never stops — a bad cap must fail loudly, not spin forever. */
function retryCap(value: number | undefined): number {
  const cap = value ?? 2;
  if (!Number.isInteger(cap) || cap < 0) {
    throw new RangeError(`maxRetries must be a non-negative integer (got ${cap}).`);
  }
  return cap;
}

/** Run the executor once, converting a thrown/rejected executor into the UNKNOWN
 *  outcome: a driver crash or network error leaves the step's effect unobserved,
 *  which is exactly the outcome R8a forbids retrying. The run keeps its structure —
 *  a rejection never escapes `runWorkflow` as a bare throw. */
async function attempt(
  step: EngineStep,
  index: number,
  execute: StepExecutor,
): Promise<{ result: StepOutcome; error?: string }> {
  try {
    return { result: await execute(step, index) };
  } catch (error) {
    return {
      result: { outcome: "unknown" },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Drive one step to a verdict: `null` when it completed, else why the run stops. */
async function runStep(
  step: EngineStep,
  index: number,
  execute: StepExecutor,
  maxRetries: number,
  leaseHeld: () => boolean,
): Promise<StepStop | null> {
  for (let retries = 0; ; ) {
    // R11 — re-checked before EVERY attempt, not just the first: a lease lost while
    // `execute` was pending must not be followed by a retry that acts on a page the
    // AI no longer owns.
    if (!leaseHeld()) return LEASE_LOST;

    const { result, error } = await attempt(step, index, execute);

    // R11 — re-check AFTER the await too: ownership can be lost while the executor is
    // pending. Even a step that resolved success must pause (not complete) if the lease
    // is gone, so the rest of the workflow never runs on a page the AI no longer owns.
    if (!leaseHeld()) return LEASE_LOST;

    const action = decideAfterResult(step.write, result);

    switch (action) {
      case "done":
        return null;
      case "stop-and-ask":
        return needsHuman(step, error ?? "uncertain or unretryable outcome");
      case "retry":
        break;
      default: {
        const exhaustive: never = action;
        throw new Error(`unhandled next action: ${String(exhaustive)}`);
      }
    }

    if (step.retryable === false) {
      return needsHuman(step, "a human gate is never re-run automatically");
    }
    retries += 1;
    if (retries > maxRetries) {
      return {
        status: "failed",
        reasonCode: "retries-exhausted",
        reason: `step '${step.id}' failed after ${maxRetries} retries`,
      };
    }
  }
}

/**
 * Execute `steps` in order. Completes only if every step succeeds; otherwise
 * pauses (needs a human) or fails, reporting where and why. Throws only on invalid
 * configuration — a failing executor produces a result, never an exception.
 */
export async function runWorkflow(
  steps: readonly EngineStep[],
  execute: StepExecutor,
  options: RunOptions = {},
): Promise<WorkflowRunResult> {
  const maxRetries = retryCap(options.maxRetries);
  // Fail closed on a throwing lease callback: a thrown lease check is not "still held".
  // Keeping the structured-stop contract (a rejection never escapes runWorkflow) means a
  // throw here becomes a paused lease-lost result, not an escaped exception.
  const rawLease = options.leaseHeld ?? (() => true);
  const leaseHeld = (): boolean => {
    try {
      return rawLease();
    } catch {
      return false;
    }
  };
  // Snapshot the input array so a concurrent splice mid-run cannot change which steps
  // execute (the elements are already frozen by the runner; this guards the array too).
  const stepList = [...steps];
  let completedSteps = 0;

  for (let i = 0; i < stepList.length; i++) {
    const step = stepList[i];
    const stop = await runStep(step, i, execute, maxRetries, leaseHeld);
    if (stop) return { ...stop, completedSteps, pausedAt: step.id };
    completedSteps += 1;
  }

  return { status: "completed", completedSteps };
}
