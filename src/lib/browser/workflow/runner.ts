/**
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

/**
 * Execute a parsed workflow end-to-end under R8a write-safety. Completes only if
 * every step succeeds; otherwise pauses (needs a human) or fails, reporting where.
 */
export async function runWebWorkflow(
  workflow: WebWorkflow,
  execute: WorkflowStepExecutor,
  options: RunOptions = {},
): Promise<WorkflowRunResult> {
  // Snapshot before classifying. Executing from the live `workflow.steps` would let a
  // mutation during the (async) run pair a read-classified engine step with a step the
  // safety layer never saw — a write executed under read rules is the R8a double-post.
  const steps: readonly WorkflowStep[] = [...workflow.steps];
  const engineSteps = steps.map(toEngineStep);
  return runWorkflow(engineSteps, (_engineStep, index) => execute(steps[index], index), options);
}
