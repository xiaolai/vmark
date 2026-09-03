/**
 * Run request validation (WI-NB6.2, audit 2026-09-03 W-05 / W-07 / W-09) —
 * everything that must hold before `startWorkflowRun` takes a lease.
 *
 * Bounds (D1v2 residuals): ≤ 25 steps, source ≤ 64 KiB UTF-8, ≤ 64 inputs, each
 * value ≤ 4 KiB UTF-8 — measured with `TextEncoder`, never `.length`.
 *
 * Inputs are checked as OWN properties (`Object.hasOwn`): `inputs["constructor"]`
 * on a plain object is `Object`, so the `=== undefined` test used to accept a
 * declared input nobody supplied. An UNDECLARED extra input is refused rather
 * than ignored: it would silently drop out of the ledger key while the author
 * believed it parameterised the run.
 *
 * Resume (`resumeRunId`): the named run must exist (`RUN_NOT_FOUND`), be paused
 * (`RESUME_NOT_PAUSED`), belong to the same tab (`RESUME_TAB_MISMATCH`) and share
 * the same NORMALISED source (`RESUME_SOURCE_MISMATCH`) — inputs may differ, the
 * completed set carries over regardless. A paused run does not count as live, so
 * it never blocks its own resume.
 *
 * @coordinates-with services/workflow/workflowRunService.ts — the caller
 * @coordinates-with lib/browser/workflow/identity.ts — the ledger identity
 * @module services/workflow/workflowRunValidate
 */

import { parseWorkflow } from "@/lib/browser/workflow/parser";
import { workflowIdentity, type WorkflowIdentity } from "@/lib/browser/workflow/identity";
import type { WebWorkflow } from "@/lib/browser/workflow/types";
import { getRun, hasLiveRun, type RunState } from "./runRegistry";

const MAX_STEPS = 25;
const MAX_INPUTS = 64;
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_VALUE_BYTES = 4 * 1024;

export interface RunRequest {
  tabId: string;
  inputs: Record<string, string>;
  resumeRunId?: string;
}

export interface ValidatedRun {
  workflow: WebWorkflow;
  identity: WorkflowIdentity;
  /** The paused run being continued, when `resumeRunId` was given. */
  resume: RunState | null;
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function checkResume(runId: string, req: RunRequest, identity: WorkflowIdentity): RunState | { error: string } {
  const run = getRun(runId);
  if (!run) return { error: "RUN_NOT_FOUND" };
  if (run.status !== "paused") return { error: "RESUME_NOT_PAUSED" };
  if (run.tabId !== req.tabId) return { error: "RESUME_TAB_MISMATCH" };
  if (run.sourceHash !== identity.sourceHash) return { error: "RESUME_SOURCE_MISMATCH" };
  return run;
}

/** Validate a run request. Returns the parsed workflow with its ledger identity,
 *  or the first error found. */
export function validateRunRequest(source: string, req: RunRequest): ValidatedRun | { error: string } {
  if (byteLen(source) > MAX_SOURCE_BYTES) return { error: "workflow source is too large" };
  const inputNames = Object.keys(req.inputs);
  if (inputNames.length > MAX_INPUTS) return { error: "too many inputs" };
  for (const name of inputNames) {
    if (byteLen(req.inputs[name]) > MAX_VALUE_BYTES) return { error: `input "${name}" value is too large` };
  }
  const parsed = parseWorkflow(source);
  if (!parsed.ok) return { error: `workflow parse failed: ${parsed.errors.map((e) => e.code).join(", ")}` };
  const workflow = parsed.workflow;
  if (workflow.steps.length > MAX_STEPS) return { error: `too many steps (max ${MAX_STEPS})` };
  for (const declared of workflow.inputs) {
    if (!Object.hasOwn(req.inputs, declared)) return { error: `missing input "${declared}"` };
  }
  for (const name of inputNames) {
    if (!workflow.inputs.includes(name)) return { error: `undeclared input "${name}"` };
  }
  const identity = workflowIdentity(source, req.inputs, workflow.inputs);
  let resume: RunState | null = null;
  if (req.resumeRunId !== undefined) {
    const checked = checkResume(req.resumeRunId, req, identity);
    if ("error" in checked) return checked;
    resume = checked;
  }
  if (hasLiveRun(req.tabId)) return { error: "a workflow is already running on this tab" };
  return { workflow, identity, resume };
}
