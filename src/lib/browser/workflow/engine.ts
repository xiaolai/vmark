/**
 * Web workflow execution engine (WI-4.2 / R8/R8a/R11).
 *
 * Purpose: run a parsed workflow's steps in order against an injected executor
 * (the driver in production, a mock in tests), applying the write-safety
 * decision core (safety.ts) after each step: a step completes, retries (bounded),
 * pauses for a human, or fails. The load-bearing safety rules come straight from
 * `decideAfterResult` — an UNKNOWN outcome never auto-retries, a failed write is
 * only retried when its postcondition confirms it did not apply, and a
 * confirmed-applied write is an idempotent success. The engine adds the retry
 * bound and the R11 lease check (a workflow whose automation lease is lost pauses
 * and reports rather than acting).
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
  id: string;
  write: boolean;
}

/** Runs one step and returns its three-valued outcome (+ postcondition). */
export type StepExecutor = (step: EngineStep, index: number) => Promise<StepOutcome>;

export interface RunOptions {
  /** Per-step retry cap for retryable failures (default 2). */
  maxRetries?: number;
  /** R11 — return false once the automation lease is lost; the run pauses. */
  leaseHeld?: () => boolean;
}

export interface WorkflowRunResult {
  status: "completed" | "paused" | "failed";
  /** Steps that completed successfully before the run ended. */
  completedSteps: number;
  /** The step id where the run paused or failed, if it did not complete. */
  pausedAt?: string;
  /** Human-readable reason for a pause/failure. */
  reason?: string;
}

/**
 * Execute `steps` in order. Completes only if every step succeeds; otherwise
 * pauses (needs a human) or fails, reporting where and why.
 */
export async function runWorkflow(
  steps: readonly EngineStep[],
  execute: StepExecutor,
  options: RunOptions = {},
): Promise<WorkflowRunResult> {
  const maxRetries = options.maxRetries ?? 2;
  const leaseHeld = options.leaseHeld ?? (() => true);
  let completed = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (!leaseHeld()) {
      return {
        status: "paused",
        completedSteps: completed,
        pausedAt: step.id,
        reason: "automation lease lost — a human took control",
      };
    }

    let attempts = 0;
    for (;;) {
      const outcome = await execute(step, i);
      const action = decideAfterResult(step.write, outcome);

      if (action === "done") {
        completed += 1;
        break;
      }
      if (action === "stop-and-ask") {
        return {
          status: "paused",
          completedSteps: completed,
          pausedAt: step.id,
          reason: `step '${step.id}' needs a human decision (uncertain or unretryable outcome)`,
        };
      }
      if (action === "abort") {
        return {
          status: "failed",
          completedSteps: completed,
          pausedAt: step.id,
          reason: `step '${step.id}' aborted`,
        };
      }
      // action === "retry"
      attempts += 1;
      if (attempts > maxRetries) {
        return {
          status: "failed",
          completedSteps: completed,
          pausedAt: step.id,
          reason: `step '${step.id}' failed after ${maxRetries} retries`,
        };
      }
    }
  }

  return { status: "completed", completedSteps: completed };
}
