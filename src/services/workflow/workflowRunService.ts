/**
 * Workflow run orchestrator (WI-NB6.2/6.3) — starts, tracks, and cancels async
 * workflow runs.
 *
 * `startWorkflowRun` validates the source (parse + inputs + bounds), acquires
 * the AI lease, creates a run record, and starts the run DETACHED — it returns a
 * `runId` synchronously, because the bridge bounds a single request at ~20s and
 * a run can take longer (Codex review). The run executes in the event loop,
 * updating the registry as it goes; the model polls `workflowRunStatus` and may
 * `cancelWorkflowRun`.
 *
 * The engine (`runWebWorkflow`) drives each step through `makeRunExecutor`; the
 * `leaseHeld` thunk ties the run to the lease, so a human takeover pauses it. On
 * any terminal outcome the run releases the lease and withdraws its own pending
 * prompts (closing the late-Allow race).
 *
 * @coordinates-with lib/browser/workflow/runner.ts — the engine
 * @coordinates-with services/workflow/runExecutor.ts — the step executor
 * @coordinates-with services/workflow/runRegistry.ts — run state + write ledger
 * @module services/workflow/workflowRunService
 */

import { parseWorkflow } from "@/lib/browser/workflow/parser";
import { runWebWorkflow } from "@/lib/browser/workflow/runner";
import { stepWrites } from "@/lib/browser/workflow/classify";
import { useBrowserLeaseStore } from "@/services/browser/lease";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { makeRunExecutor } from "./runExecutor";
import {
  createRun,
  getRun,
  hasLiveRun,
  markWriteStepDone,
  updateRun,
  writeStepAlreadyDone,
  type RunState,
} from "./runRegistry";

/** v1 run bounds (recorded residuals in the plan). */
const MAX_STEPS = 25;
const MAX_INPUTS = 64;
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_VALUE_BYTES = 4 * 1024;

export interface StartRunContext {
  tabId: string;
  resolveTab: () => { url: string; generation: number } | null;
  inputs: Record<string, string>;
  /** Wall-clock budget for the run (ms); default 120s. Approval waits count. */
  deadlineMs?: number;
  now?: () => number;
  allowRepeat?: boolean;
}

export type StartRunResult =
  | { ok: true; runId: string; steps: number }
  | { ok: false; error: string };

/** Cheap, stable content hash for the completed-write ledger key. */
function hashSource(source: string): string {
  let h = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Validate everything that must hold before a run starts. */
function validate(source: string, ctx: StartRunContext): { error: string } | { workflow: ReturnType<typeof parseWorkflow> } {
  if (byteLen(source) > MAX_SOURCE_BYTES) return { error: "workflow source is too large" };
  const inputNames = Object.keys(ctx.inputs);
  if (inputNames.length > MAX_INPUTS) return { error: "too many inputs" };
  for (const name of inputNames) {
    if (byteLen(ctx.inputs[name]) > MAX_VALUE_BYTES) return { error: `input "${name}" value is too large` };
  }
  const parsed = parseWorkflow(source);
  if (!parsed.ok) {
    return { error: `workflow parse failed: ${parsed.errors.map((e) => e.code).join(", ")}` };
  }
  if (parsed.workflow.steps.length > MAX_STEPS) return { error: `too many steps (max ${MAX_STEPS})` };
  for (const declared of parsed.workflow.inputs) {
    if (ctx.inputs[declared] === undefined) return { error: `missing input "${declared}"` };
  }
  if (hasLiveRun(ctx.tabId)) return { error: "a workflow is already running on this tab" };
  return { workflow: parsed };
}

/** Start a run; returns a runId synchronously and executes detached. */
export function startWorkflowRun(source: string, ctx: StartRunContext): StartRunResult {
  const checked = validate(source, ctx);
  if ("error" in checked) return { ok: false, error: checked.error };
  const parsed = checked.workflow;
  if (!parsed.ok) return { ok: false, error: "workflow parse failed" };
  const workflow = parsed.workflow;

  const now = ctx.now ?? Date.now;
  const sourceHash = hashSource(source);
  const deadlineAt = now() + (ctx.deadlineMs ?? 120_000);

  if (!useBrowserLeaseStore.getState().acquireForAi(ctx.tabId)) {
    return { ok: false, error: "the human is currently driving this tab" };
  }
  const run = createRun({ tabId: ctx.tabId, sourceHash, stepCount: workflow.steps.length, deadlineAt });

  const executor = makeRunExecutor({
    tabId: ctx.tabId,
    runId: run.runId,
    inputs: ctx.inputs,
    resolveTab: ctx.resolveTab,
    deadlineAt,
    now,
  });

  // Skip completed write steps on a re-run (unless allowed): a write that
  // already succeeded for this (tab, source) must not run twice.
  const guardedExecutor: typeof executor = async (step, index) => {
    const stepId = `step-${step.index}`;
    if (!ctx.allowRepeat && stepWrites(step) && writeStepAlreadyDone(ctx.tabId, sourceHash, stepId)) {
      updateRun(run.runId, { stepResults: [...(getRun(run.runId)?.stepResults ?? []), { index: step.index, outcome: "skipped" }] });
      return { outcome: "success", postconditionMet: true };
    }
    const outcome = await executor(step, index);
    if (outcome.outcome === "success" && stepWrites(step)) {
      markWriteStepDone(ctx.tabId, sourceHash, stepId);
    }
    const prev = getRun(run.runId)?.stepResults ?? [];
    updateRun(run.runId, {
      stepResults: [...prev, { index: step.index, outcome: outcome.outcome === "success" ? "success" : "failed" }],
      completedSteps: outcome.outcome === "success" ? prev.length + 1 : prev.length,
    });
    return outcome;
  };

  void runWebWorkflow(workflow, guardedExecutor, {
    maxRetries: 2,
    leaseHeld: () => useBrowserLeaseStore.getState().currentHolder(ctx.tabId) === "ai",
  })
    .then((result) => finish(run.runId, ctx.tabId, result))
    .catch((error: unknown) => {
      finish(run.runId, ctx.tabId, {
        status: "failed",
        completedSteps: getRun(run.runId)?.completedSteps ?? 0,
        reasonCode: "internal",
        reason: error instanceof Error ? error.message : String(error),
      });
    });

  return { ok: true, runId: run.runId, steps: workflow.steps.length };
}

type EngineResult = {
  status: "completed" | "paused" | "failed";
  completedSteps: number;
  pausedAt?: string;
  reasonCode?: string;
  reason?: string;
};

/** Terminal cleanup: map the engine result to a status, release the lease if
 *  still AI-held, and withdraw the run's pending prompts (late-Allow race). */
function finish(runId: string, tabId: string, result: EngineResult): void {
  const run = getRun(runId);
  if (!run || run.status === "cancelled") return; // a cancel already finalized it
  const status = result.status === "paused" ? "paused" : result.status;
  updateRun(runId, {
    status,
    completedSteps: result.completedSteps,
    ...(result.pausedAt !== undefined ? { pausedAt: result.pausedAt } : {}),
    ...(result.reasonCode !== undefined ? { reasonCode: result.reasonCode } : {}),
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
  });
  // A paused run keeps its lease (the user may resolve an approval and it
  // continues via a re-run); a completed/failed run releases it.
  if (status !== "paused" && useBrowserLeaseStore.getState().currentHolder(tabId) === "ai") {
    useBrowserLeaseStore.getState().release(tabId, "ai");
  }
  if (status !== "paused") {
    useBrowserApprovalStore.getState().withdrawByRun(runId);
  }
}

/** The current state of a run, for `workflow_status`. */
export function workflowRunStatus(runId: string): RunState | null {
  return getRun(runId);
}

/** Cancel a run — never approval-gated (stopping is always allowed, WI-19).
 *  Withdraws its prompts and releases the lease. */
export function cancelWorkflowRun(runId: string): void {
  const run = getRun(runId);
  if (!run) return;
  updateRun(runId, { status: "cancelled", reasonCode: "cancelled", reason: "cancelled by user" });
  useBrowserApprovalStore.getState().withdrawByRun(runId);
  if (useBrowserLeaseStore.getState().currentHolder(run.tabId) === "ai") {
    useBrowserLeaseStore.getState().release(run.tabId, "ai");
  }
}
