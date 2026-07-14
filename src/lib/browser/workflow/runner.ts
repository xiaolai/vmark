/**
 * ⚠️ **NOT WIRED — no production caller.** `runWebWorkflow` is invoked only by tests;
 * see engine.ts for the missing per-attempt approval gate this must not ship without.
 *
 * Purpose: Top-level web-workflow runner (WI-4.2) — the capstone that wires the
 * parsed IR to the R8a-safe engine. It maps each `WorkflowStep` to the engine's
 * safety shape via the write-ness classifier, then drives the generic
 * `runWorkflow` control flow, handing the executor the ORIGINAL step so it knows
 * how to act (kind selects the tier; text is the instruction).
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-4.2.
 *
 * The two shapes are kept apart on purpose: the safety layer only ever sees
 * `{id, write}` (so its double-post protection depends on nothing but write-ness),
 * while the executor sees the full `WorkflowStep`. Positional index bridges them —
 * `engineSteps[i]` corresponds to `workflow.steps[i]`.
 *
 * The `execute` executor is injected: the driver-backed implementation (native,
 * live-gated) in production, a mock in tests. This module is pure orchestration.
 *
 * @coordinates-with lib/browser/workflow/engine.ts — the generic step runner
 * @coordinates-with lib/browser/workflow/classify.ts — IR → write-ness
 */
import { toEngineStep } from "./classify";
import { runWorkflow, type RunOptions, type StepExecutor, type WorkflowRunResult } from "./engine";
import type { WebWorkflow, WorkflowStep } from "./types";

/** Runs one parsed step and reports its three-valued outcome. Injected by the caller. */
export type WorkflowStepExecutor = (step: WorkflowStep, index: number) => Promise<StepOutcomeShape>;
type StepOutcomeShape = Awaited<ReturnType<StepExecutor>>;

/** Collapse a step into a fresh FROZEN plain object, reading each field exactly once.
 *  A shared/Proxy/getter-backed step could otherwise report one `kind` when classified
 *  and another when executed — a write run under read rules (the R8a double-post). */
function freezeStep(step: WorkflowStep): WorkflowStep {
  return Object.freeze({ index: step.index, kind: step.kind, text: step.text, line: step.line });
}

/**
 * Execute a parsed workflow end-to-end under R8a write-safety. Completes only if
 * every step succeeds; otherwise pauses (needs a human) or fails, reporting where.
 */
export async function runWebWorkflow(
  workflow: WebWorkflow,
  execute: WorkflowStepExecutor,
  options: RunOptions = {},
): Promise<WorkflowRunResult> {
  // Snapshot AND freeze before classifying. A shallow `[...workflow.steps]` copy would
  // still share the step OBJECTS, so a getter/Proxy-backed `kind` could be read as a
  // read at classification and a write at execution. Freezing each into a fresh plain
  // object reads every field once, so the safety layer and the executor see the same step.
  const steps: readonly WorkflowStep[] = workflow.steps.map(freezeStep);
  const engineSteps = steps.map(toEngineStep);
  return runWorkflow(engineSteps, (_engineStep, index) => execute(steps[index], index), options);
}
