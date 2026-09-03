/**
 * Workflow run registry (WI-NB6.2) — in-memory, session-scoped state for
 * async workflow runs.
 *
 * A `workflow_run` starts the run detached and returns a `runId` immediately
 * (the bridge transport hard-bounds any single request at ~20s, so a run cannot
 * live inside one — Codex review). The model then polls `workflow_status` and
 * may `workflow_cancel`. This module holds:
 *   - the per-run state a status poll reads (D1v2 contract: `pendingApproval`,
 *     `firstStep`, ONE `stepResults` entry per step with attempts folded,
 *     `completedSteps` = distinct completed indices, skips counted apart);
 *   - a one-live-run-per-tab guard — `running` only: a PAUSED run frees its tab,
 *     because the documented resume path is a new run on the same tab (audit
 *     2026-09-03 W-05);
 *   - which run currently holds the tab's lease, so a cancel releases the lease
 *     only if THIS run holds it (W-08);
 *   - the per-run `AbortController` that cancel and human takeover fire (W-01);
 *   - the per-(tabId, ledgerId) completed-write LEDGER: a re-run of the same
 *     source with the same inputs must not re-execute a write step that already
 *     succeeded. The `ledgerId` is `workflowIdentity`'s normalised-source +
 *     inputs hash (W-07), so a whitespace edit keeps the ledger and new inputs get
 *     a fresh one. Reads are idempotent, so they re-run freely; only writes are
 *     ledgered.
 *
 * Session-scoped by design (a residual): the ledger does not survive an app
 * restart. Durable runs are future work.
 *
 * @coordinates-with services/workflow/workflowRunService.ts — the orchestrator
 * @coordinates-with lib/browser/workflow/identity.ts — computes the ledgerId
 * @module services/workflow/runRegistry
 */

import type { ActionTarget } from "@/stores/browserApprovalStore.types";

export type RunStatus = "running" | "paused" | "completed" | "failed" | "cancelled" | "superseded";

export type StepResultStatus = "running" | "success" | "failed" | "unknown" | "skipped";

interface RunStepResult {
  index: number;
  status: StepResultStatus;
  /** How many times the executor was invoked for this step (a skip is 0). */
  attempts: number;
  /** Why it failed / was skipped / paused, when it did. */
  reason?: string;
  /** Step output for the model (an `extract:` step's reader summary). */
  data?: Record<string, unknown>;
}

/** The prompt a run is currently waiting on, for `workflow_status`. */
export interface PendingApprovalInfo {
  operation: string;
  /** The origin the prompt is about (already reduced for the model). */
  url: string;
  target?: ActionTarget;
}

export interface RunState {
  runId: string;
  tabId: string;
  sourceHash: string;
  inputsHash: string;
  status: RunStatus;
  stepCount: number;
  /** The id of the first step this run will actually execute (null when every
   *  step is already done). */
  firstStep: string | null;
  /** Distinct step indices that completed successfully. */
  completedSteps: number;
  /** Distinct step indices skipped as already completed / done by a human. */
  skippedSteps: number;
  pausedAt?: string;
  reasonCode?: string;
  reason?: string;
  pendingApproval?: PendingApprovalInfo;
  /** The paused run this one continues from, if it was started as a resume. */
  resumedFrom?: string;
  stepResults: RunStepResult[];
}

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>(["completed", "failed", "cancelled", "superseded"]);

const runs = new Map<string, RunState>();
/** tabId → runId of the one RUNNING run, if any. */
const liveByTab = new Map<string, string>();
/** tabId → runId of the run that currently holds the tab's AI lease. */
const leaseOwners = new Map<string, string>();
/** runId → the controller cancel / takeover abort. */
const aborts = new Map<string, AbortController>();
/** `${tabId}\u0000${ledgerId}` → set of completed write-step ids. */
const writeLedger = new Map<string, Set<string>>();

let counter = 0;

interface CreateRunArgs {
  tabId: string;
  sourceHash: string;
  inputsHash: string;
  stepCount: number;
  firstStep: string | null;
  resumedFrom?: string;
}

/** Create a running record. The caller must have checked `hasLiveRun` first. */
export function createRun(args: CreateRunArgs): RunState {
  counter += 1;
  const runId = `wfrun-${args.tabId}-${counter}`;
  const state: RunState = {
    runId,
    tabId: args.tabId,
    sourceHash: args.sourceHash,
    inputsHash: args.inputsHash,
    status: "running",
    stepCount: args.stepCount,
    firstStep: args.firstStep,
    completedSteps: 0,
    skippedSteps: 0,
    ...(args.resumedFrom !== undefined ? { resumedFrom: args.resumedFrom } : {}),
    stepResults: [],
  };
  runs.set(runId, state);
  liveByTab.set(args.tabId, runId);
  return state;
}

export function getRun(runId: string): RunState | null {
  return runs.get(runId) ?? null;
}

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

/** Patch a run's state; frees the tab as soon as the run is no longer running. */
export function updateRun(runId: string, patch: Partial<RunState>): void {
  const state = runs.get(runId);
  if (!state) return;
  Object.assign(state, patch);
  if (state.status !== "running" && liveByTab.get(state.tabId) === runId) {
    liveByTab.delete(state.tabId);
  }
}

/** Whether a tab already has a RUNNING run (a paused run does not count). */
export function hasLiveRun(tabId: string): boolean {
  return liveByTab.has(tabId);
}

function recount(state: RunState): void {
  state.completedSteps = state.stepResults.filter((s) => s.status === "success").length;
  state.skippedSteps = state.stepResults.filter((s) => s.status === "skipped").length;
}

/** Find-or-create the single entry for `index`, keeping the list ordered by index. */
function entryFor(state: RunState, index: number): RunStepResult {
  const existing = state.stepResults.find((s) => s.index === index);
  if (existing) return existing;
  const created: RunStepResult = { index, status: "running", attempts: 0 };
  state.stepResults = [...state.stepResults, created].sort((a, b) => a.index - b.index);
  return created;
}

/** The executor is about to run step `index` (again): fold the attempt in. */
export function noteStepAttempt(runId: string, index: number): void {
  const state = runs.get(runId);
  if (!state) return;
  const entry = entryFor(state, index);
  entry.attempts += 1;
  entry.status = "running";
  delete entry.reason;
  state.stepResults = [...state.stepResults];
  recount(state);
}

/** Record how step `index` ended (this attempt, or a skip with no attempt). */
export function noteStepResult(
  runId: string,
  index: number,
  result: { status: Exclude<StepResultStatus, "running">; reason?: string; data?: Record<string, unknown> },
): void {
  const state = runs.get(runId);
  if (!state) return;
  const entry = entryFor(state, index);
  entry.status = result.status;
  if (result.reason !== undefined) entry.reason = result.reason;
  else delete entry.reason;
  if (result.data !== undefined) entry.data = result.data;
  state.stepResults = [...state.stepResults];
  recount(state);
}

/** Set (or clear, with null) the prompt the run is waiting on. */
export function setPendingApproval(runId: string, info: PendingApprovalInfo | null): void {
  const state = runs.get(runId);
  if (!state) return;
  if (info === null) delete state.pendingApproval;
  else state.pendingApproval = info;
}

export function registerRunAbort(runId: string, controller: AbortController): void {
  aborts.set(runId, controller);
}

export function getRunAbort(runId: string): AbortController | null {
  return aborts.get(runId) ?? null;
}

/** Record that `runId` acquired the tab's AI lease. */
export function claimLease(tabId: string, runId: string): void {
  leaseOwners.set(tabId, runId);
}

export function leaseOwnerRunId(tabId: string): string | null {
  return leaseOwners.get(tabId) ?? null;
}

/** Drop the claim if (and only if) `runId` holds it; returns whether it did. */
export function releaseLeaseClaim(tabId: string, runId: string): boolean {
  if (leaseOwners.get(tabId) !== runId) return false;
  leaseOwners.delete(tabId);
  return true;
}

function ledgerKey(tabId: string, ledgerId: string): string {
  return `${tabId}\u0000${ledgerId}`;
}

/** Has this write step already succeeded for this (tab, ledgerId) this session? */
export function writeStepAlreadyDone(tabId: string, ledgerId: string, stepId: string): boolean {
  return writeLedger.get(ledgerKey(tabId, ledgerId))?.has(stepId) ?? false;
}

/** Record a write step's success, so a re-run skips it. */
export function markWriteStepDone(tabId: string, ledgerId: string, stepId: string): void {
  const key = ledgerKey(tabId, ledgerId);
  const set = writeLedger.get(key) ?? new Set<string>();
  set.add(stepId);
  writeLedger.set(key, set);
}

/** Test-only: clear all run + ledger state. */
export function __resetRunRegistry(): void {
  runs.clear();
  liveByTab.clear();
  leaseOwners.clear();
  aborts.clear();
  writeLedger.clear();
  counter = 0;
}
