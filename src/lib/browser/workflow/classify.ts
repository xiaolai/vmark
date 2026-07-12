/**
 * Purpose: Step write-ness classifier (WI-4.2 / R8a) — the bridge between the
 * parsed workflow IR (`WorkflowStep`, which carries an execution-tier `kind`) and
 * the engine's `EngineStep.write` flag. Execution tier (api/action/goal) and
 * read-vs-write semantics are ORTHOGONAL: a `goal` step can "find the article"
 * (read) or "publish the draft" (write), so `kind` alone cannot decide write-ness.
 * Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-4.2.
 *
 * Classification is STRUCTURAL and FAIL-SAFE, never a keyword guess:
 *   - `extract` (reader) and `confirm` (human gate) are read-only by construction —
 *     neither submits anything.
 *   - `api` / `action` / `goal` default to WRITE. Under R8a a write never
 *     auto-retries and never auto-escalates, so defaulting an ambiguous step to
 *     write is the safe direction: worst case the run stops and asks a human — it
 *     can never cause the double-post that reading a write as a read would.
 *
 * We deliberately do NOT inspect `step.text`. A "Publish"-substring heuristic could
 * misread a write as a read (the exact R8a failure); structural classification cannot.
 *
 * Residual (WI-4.5 grammar decision, not guessable here): syntax for an author to
 * mark an api/action/goal step as a read so it may self-heal. Until that exists,
 * such steps run conservatively (no auto-heal), which is safe, just cautious.
 *
 * @coordinates-with lib/browser/workflow/engine.ts — consumes EngineStep.write
 */
import type { EngineStep } from "./engine";
import type { StepKind, WorkflowStep } from "./types";

/** Kinds that are read-only by construction — they never mutate remote state. */
const READ_KINDS: ReadonlySet<StepKind> = new Set<StepKind>(["extract", "confirm"]);

/**
 * Whether a step mutates remote state. Structural + fail-safe: read-only kinds
 * are reads; every other kind defaults to write (see module doc for why that
 * default is the safe one). A future StepKind added without a decision inherits
 * the write default — conservative by construction.
 */
export function stepWrites(step: WorkflowStep): boolean {
  return !READ_KINDS.has(step.kind);
}

/** Project a parsed step onto the engine's safety-relevant shape. */
export function toEngineStep(step: WorkflowStep): EngineStep {
  return { id: `step-${step.index}`, write: stepWrites(step) };
}
