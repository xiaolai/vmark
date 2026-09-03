/**
 * Workflow run orchestrator (WI-NB6.2/6.3) — starts, tracks, and cancels async
 * workflow runs.
 *
 * `startWorkflowRun` validates the request (`workflowRunValidate.ts`), acquires
 * the AI lease, creates a run record, and starts the run DETACHED — it returns a
 * `runId` synchronously, because the bridge bounds a single request at ~20s and
 * a run can take longer (Codex review). The run executes in the event loop,
 * updating the registry as it goes; the model polls `workflowRunStatus` and may
 * `cancelWorkflowRun`.
 *
 * The engine (`runWebWorkflow`) drives each step through `makeRunExecutor`,
 * wrapped by `makeGuardedExecutor` (ledger skips, the running-time budget, one
 * step result per step). Audit 2026-09-03:
 *   - W-01: every run has an `AbortController`; `cancelWorkflowRun` aborts it,
 *     and it is registered as the lease's in-flight canceller so a human takeover
 *     (`reclaimForHuman`/`release`) aborts it too. An approval wait exits at once.
 *   - W-04/W-05: EVERY end state — including `paused` — releases the lease,
 *     clears a fresh human hold (the interrupted run is over) and withdraws the
 *     run's prompts; a paused run frees its tab, and `resumeRunId` continues it.
 *   - W-06: the D1v2 clock — 120 s of RUNNING time, paused while a prompt is open.
 *   - W-07: the ledger is keyed on `workflowIdentity` (normalised source + inputs).
 *   - W-08: cancel is a no-op on a terminal run, refuses an unknown run, and
 *     releases the lease only if THIS run holds it.
 *
 * @coordinates-with lib/browser/workflow/runner.ts — the engine
 * @coordinates-with services/workflow/runExecutor.ts — the step executor
 * @coordinates-with services/workflow/runStepGuard.ts — ledger skips + step results
 * @coordinates-with services/workflow/runRegistry.ts — run state + write ledger
 * @module services/workflow/workflowRunService
 */

import { runWebWorkflow } from "@/lib/browser/workflow/runner";
import { WorkflowPause, type RunStopCode } from "@/lib/browser/workflow/engine";
import type { WorkflowStep } from "@/lib/browser/workflow/types";
import { useBrowserLeaseStore } from "@/services/browser/lease";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { makeRunExecutor } from "./runExecutor";
import { createRunClock, type RunClock } from "./runClock";
import { makeGuardedExecutor, stepWillBeSkipped, type SkipPolicy } from "./runStepGuard";
import { validateRunRequest } from "./workflowRunValidate";
import {
  claimLease,
  createRun,
  getRun,
  getRunAbort,
  isTerminalStatus,
  registerRunAbort,
  unregisterRunAbort,
  releaseLeaseClaim,
  setPendingApproval,
  updateRun,
  type RunState,
  type RunStatus,
} from "./runRegistry";

/** D1v2 run budget: 120 s of RUNNING time (approval waits excluded). */
const DEFAULT_BUDGET_MS = 120_000;

export interface StartRunContext {
  tabId: string;
  resolveTab: () => { url: string; generation: number } | null;
  inputs: Record<string, string>;
  /** Running-time budget for the run (ms); default 120 s. Approval waits do not count. */
  deadlineMs?: number;
  now?: () => number;
  allowRepeat?: boolean;
  /** Continue a PAUSED run on the same tab with the same normalised source: its
   *  completed steps and the step it paused at (the human did it) are skipped. */
  resumeRunId?: string;
  /** Test seam: approval poll interval (ms). */
  pollMs?: number;
  /** A `navigate to` step landed: the caller mirrors the page onto the tab record. */
  onNavigated?: (nav: { url: string; generation: number }) => void;
}

export type StartRunResult =
  | { ok: true; runId: string; steps: number; firstStep: string | null }
  | { ok: false; error: string };

export type CancelResult =
  | { outcome: "cancelled" }
  | { outcome: "already-terminal"; status: RunStatus }
  | { outcome: "not-found" };

/** `step-N` → N, or null for anything else. */
function stepIndexOf(stepId: string | undefined): number | null {
  const m = stepId === undefined ? null : /^step-(\d+)$/.exec(stepId);
  return m ? Number(m[1]) : null;
}

/** Release the tab's lease if THIS run holds the claim. A fresh human hold is the
 *  interruption of this run — it ends with the run (W-04). */
function releaseRunLease(run: RunState): void {
  if (!releaseLeaseClaim(run.tabId, run.runId)) return;
  const lease = useBrowserLeaseStore.getState();
  const holder = lease.currentHolder(run.tabId);
  if (holder !== null) lease.release(run.tabId, holder);
}

/** Start a run; returns a runId synchronously and executes detached. */
export function startWorkflowRun(source: string, ctx: StartRunContext): StartRunResult {
  const checked = validateRunRequest(source, {
    tabId: ctx.tabId,
    inputs: ctx.inputs,
    ...(ctx.resumeRunId !== undefined ? { resumeRunId: ctx.resumeRunId } : {}),
  });
  if ("error" in checked) return { ok: false, error: checked.error };
  const { workflow, identity, resume } = checked;
  const now = ctx.now ?? Date.now;
  // Validate the budget BEFORE anything is mutated: a bad deadline used to throw
  // after the lease was acquired, the run registered and a resumed run superseded,
  // leaving a permanent live run and AI lease behind a function that returns a result.
  let clock: RunClock;
  try {
    clock = createRunClock(ctx.deadlineMs ?? DEFAULT_BUDGET_MS, now);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const lease = useBrowserLeaseStore.getState();
  if (!lease.acquireForAi(ctx.tabId)) return { ok: false, error: "the human is currently driving this tab" };

  const skipPolicy: SkipPolicy = {
    tabId: ctx.tabId,
    ledgerId: identity.ledgerId,
    allowRepeat: ctx.allowRepeat === true,
    inherited: new Set(
      resume?.stepResults.filter((s) => s.status === "success" || s.status === "skipped").map((s) => s.index) ?? [],
    ),
    humanDone: stepIndexOf(resume?.pausedAt),
  };
  const firstStep = workflow.steps.find((s: WorkflowStep) => !stepWillBeSkipped(s, skipPolicy));
  const run = createRun({
    tabId: ctx.tabId,
    sourceHash: identity.sourceHash,
    inputsHash: identity.inputsHash,
    stepCount: workflow.steps.length,
    firstStep: firstStep ? `step-${firstStep.index}` : null,
    ...(resume ? { resumedFrom: resume.runId } : {}),
  });
  if (resume) {
    updateRun(resume.runId, { status: "superseded", reasonCode: "superseded", reason: `resumed by ${run.runId}` });
  }
  claimLease(ctx.tabId, run.runId);

  const controller = new AbortController();
  registerRunAbort(run.runId, controller);
  // Human takeover (reclaim) and release fire this: the in-flight step exits at once.
  lease.setInflightCancel(ctx.tabId, () =>
    controller.abort(new WorkflowPause("lease-lost", "automation lease lost — a human took control")),
  );
  const executor = makeRunExecutor({
    tabId: ctx.tabId,
    runId: run.runId,
    inputs: ctx.inputs,
    resolveTab: ctx.resolveTab,
    clock,
    signal: controller.signal,
    leaseEpoch: lease.epochOf(ctx.tabId),
    now,
    ...(ctx.pollMs !== undefined ? { pollMs: ctx.pollMs } : {}),
    onPendingApproval: (info) => setPendingApproval(run.runId, info),
    ...(ctx.onNavigated ? { onNavigated: ctx.onNavigated } : {}),
    isWriteLedgered: (index) => stepWillBeSkipped({ index, kind: "action", text: "", line: 0 }, { ...skipPolicy, allowRepeat: false }),
  });
  const guarded = makeGuardedExecutor({ runId: run.runId, ...skipPolicy, clock, executor });

  void runWebWorkflow(workflow, guarded, {
    maxRetries: 2,
    leaseHeld: () => useBrowserLeaseStore.getState().currentHolder(ctx.tabId) === "ai",
  })
    .then((result) => finish(run.runId, result))
    .catch((error: unknown) => {
      finish(run.runId, {
        status: "failed",
        reasonCode: "internal",
        reason: error instanceof Error ? error.message : String(error),
      });
    });

  return { ok: true, runId: run.runId, steps: workflow.steps.length, firstStep: run.firstStep };
}

interface EngineResult {
  status: "completed" | "paused" | "failed";
  pausedAt?: string;
  reasonCode?: RunStopCode | "internal";
  reason?: string;
}

/** End-of-run cleanup for EVERY end state, paused included: record the status,
 *  release the lease this run holds (and a fresh human hold), and withdraw the
 *  run's prompts — an orphaned prompt is worse than a re-request. */
function finish(runId: string, result: EngineResult): void {
  const run = getRun(runId);
  if (!run || isTerminalStatus(run.status)) return; // a cancel/resume already finalized it
  updateRun(runId, {
    status: result.status,
    ...(result.pausedAt !== undefined ? { pausedAt: result.pausedAt } : {}),
    ...(result.reasonCode !== undefined ? { reasonCode: result.reasonCode } : {}),
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
  });
  setPendingApproval(runId, null);
  releaseRunLease(run);
  useBrowserApprovalStore.getState().withdrawByRun(runId);
  unregisterRunAbort(runId);
}

/** The current state of a run, for `workflow_status`. */
export function workflowRunStatus(runId: string): RunState | null {
  return getRun(runId);
}

/** Cancel a run — never approval-gated (stopping is always allowed, WI-19).
 *  Aborts the in-flight step, withdraws its prompts and releases the lease it
 *  holds. A terminal run is left alone; an unknown run is reported as such. */
export function cancelWorkflowRun(runId: string): CancelResult {
  const run = getRun(runId);
  if (!run) return { outcome: "not-found" };
  if (isTerminalStatus(run.status)) return { outcome: "already-terminal", status: run.status };
  updateRun(runId, { status: "cancelled", reasonCode: "cancelled", reason: "cancelled by user" });
  setPendingApproval(runId, null);
  getRunAbort(runId)?.abort(new WorkflowPause("cancelled", "cancelled by user"));
  unregisterRunAbort(runId);
  useBrowserApprovalStore.getState().withdrawByRun(runId);
  releaseRunLease(run);
  return { outcome: "cancelled" };
}
