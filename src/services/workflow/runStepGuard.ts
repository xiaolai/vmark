/**
 * Step guard (audit 2026-09-03 W-05 / W-06 / W-07 / W-09) — the wrapper the run
 * service puts around `makeRunExecutor`. Per step, in order:
 *
 *   1. the running-time budget is checked BEFORE the attempt (deadline → pause);
 *   2. a step that is already done is SKIPPED and reported as such — the paused-at
 *      step of a resumed run (the human did it: `done-by-human`), a step the
 *      resumed run completed, or a write in the completed-write ledger
 *      (`already-completed`; `allowRepeat` re-runs those);
 *   3. otherwise the attempt is folded into the step's ONE result entry, a
 *      successful write is ledgered, and a thrown executor is recorded as
 *      `unknown` with its message before propagating.
 *
 * `stepWillBeSkipped` is the same decision without side effects, so the run
 * service can report `firstStep` before anything runs.
 *
 * @coordinates-with services/workflow/runRegistry.ts — step results + the ledger
 * @coordinates-with services/workflow/workflowRunService.ts — the caller
 * @module services/workflow/runStepGuard
 */

import { stepWrites } from "@/lib/browser/workflow/classify";
import { WorkflowPause } from "@/lib/browser/workflow/engine";
import { decideAfterResult, type StepOutcome } from "@/lib/browser/workflow/safety";
import type { WorkflowStep } from "@/lib/browser/workflow/types";
import type { RunClock } from "./runClock";
import { markWriteStepDone, noteStepAttempt, noteStepResult, writeStepAlreadyDone } from "./runRegistry";

type WorkflowStepExecutor = (step: WorkflowStep, index: number) => Promise<StepOutcome>;

/** What decides that a step is already done. */
export interface SkipPolicy {
  tabId: string;
  ledgerId: string;
  allowRepeat: boolean;
  /** Steps a resumed run had completed (success or skipped). */
  inherited: ReadonlySet<number>;
  /** The step a resumed run paused at — the human performed it. */
  humanDone: number | null;
}

export interface StepGuardArgs extends SkipPolicy {
  runId: string;
  clock: RunClock;
  executor: WorkflowStepExecutor;
}

const stepId = (step: WorkflowStep): string => `step-${step.index}`;

function skipReason(step: WorkflowStep, policy: SkipPolicy): "done-by-human" | "already-completed" | null {
  if (policy.humanDone === step.index) return "done-by-human";
  if (policy.inherited.has(step.index)) return "already-completed";
  if (!policy.allowRepeat && stepWrites(step) && writeStepAlreadyDone(policy.tabId, policy.ledgerId, stepId(step))) {
    return "already-completed";
  }
  return null;
}

/** Whether the guard will skip `step` (no side effects). */
export function stepWillBeSkipped(step: WorkflowStep, policy: SkipPolicy): boolean {
  return skipReason(step, policy) !== null;
}

const SKIPPED: StepOutcome = { outcome: "success", postconditionMet: true };

/** Wrap `executor` with the skip / budget / recording policy. */
export function makeGuardedExecutor(args: StepGuardArgs): WorkflowStepExecutor {
  return async (step, index) => {
    if (args.clock.expired()) throw new WorkflowPause("deadline", "the run's running-time budget is spent");
    const skipped = skipReason(step, args);
    if (skipped !== null) {
      noteStepResult(args.runId, step.index, { status: "skipped", reason: skipped });
      return SKIPPED;
    }
    noteStepAttempt(args.runId, step.index);
    let outcome: StepOutcome;
    try {
      outcome = await args.executor(step, index);
    } catch (error) {
      noteStepResult(args.runId, step.index, {
        status: "unknown",
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    // Ledger a write only when the engine's own verdict is "done": a success whose
    // postcondition says it did NOT land is not done (and was being ledgered), and a
    // failed write whose postcondition says it DID land is done (and was not).
    if (stepWrites(step) && decideAfterResult(true, outcome) === "done") {
      markWriteStepDone(args.tabId, args.ledgerId, stepId(step));
    }
    noteStepResult(args.runId, step.index, {
      status: outcome.outcome,
      ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      ...(outcome.data !== undefined ? { data: outcome.data } : {}),
    });
    return outcome;
  };
}
