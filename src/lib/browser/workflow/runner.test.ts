// Top-level web-workflow runner — parser IR → classify → engine (WI-4.2).
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-4.2 (R8a)
import { describe, expect, it, vi } from "vitest";
import type { StepOutcome } from "./safety";
import type { StepKind, WebWorkflow, WorkflowStep } from "./types";
import { runWebWorkflow, type WorkflowStepExecutor } from "./runner";

function step(index: number, kind: StepKind, text = "x"): WorkflowStep {
  return { index, kind, text, line: index };
}
function workflow(steps: WorkflowStep[]): WebWorkflow {
  return { site: "demo", inputs: [], steps };
}
const ok = (): StepOutcome => ({ outcome: "success" });

describe("runWebWorkflow", () => {
  it("completes when every step succeeds", async () => {
    const wf = workflow([step(1, "extract"), step(2, "goal"), step(3, "confirm")]);
    const result = await runWebWorkflow(wf, async () => ok());
    expect(result).toEqual({ status: "completed", completedSteps: 3 });
  });

  it("hands the executor the original WorkflowStep (kind + text), not the engine shape", async () => {
    const wf = workflow([step(1, "action", "click Publish")]);
    const execute = vi.fn<WorkflowStepExecutor>(async () => ok());
    await runWebWorkflow(wf, execute);
    const [received, index] = execute.mock.calls[0];
    expect(received.kind).toBe("action");
    expect(received.text).toBe("click Publish");
    expect(index).toBe(0);
  });

  it("preserves positional correspondence between engine step and IR step", async () => {
    const wf = workflow([step(1, "extract"), step(2, "goal"), step(3, "api")]);
    const seen: Array<{ index: number; kind: StepKind }> = [];
    await runWebWorkflow(wf, async (s, i) => {
      seen.push({ index: i, kind: s.kind });
      return ok();
    });
    expect(seen).toEqual([
      { index: 0, kind: "extract" },
      { index: 1, kind: "goal" },
      { index: 2, kind: "api" },
    ]);
  });

  it("applies write-safety: an inconclusive write pauses (never double-executes)", async () => {
    // A `goal` step is a write by default; an `unknown` outcome must stop-and-ask.
    const wf = workflow([step(1, "goal", "publish the draft")]);
    const execute = vi.fn<WorkflowStepExecutor>(async () => ({ outcome: "unknown" }));
    const result = await runWebWorkflow(wf, execute);
    expect(result.status).toBe("paused");
    expect(result.pausedAt).toBe("step-1");
    // The unknown-outcome write ran exactly once — no retry that could double-post.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("applies read idempotency: a failed read retries within the cap", async () => {
    // An `extract` step is a read; a transient failure may retry.
    const wf = workflow([step(1, "extract")]);
    let calls = 0;
    const execute: WorkflowStepExecutor = async () => {
      calls += 1;
      return calls < 2 ? { outcome: "failed" } : ok();
    };
    const result = await runWebWorkflow(wf, execute, { maxRetries: 3 });
    expect(result.status).toBe("completed");
    expect(calls).toBe(2);
  });

  it("pauses when the automation lease is lost (R11)", async () => {
    const wf = workflow([step(1, "goal")]);
    const result = await runWebWorkflow(wf, async () => ok(), { leaseHeld: () => false });
    expect(result.status).toBe("paused");
    expect(result.reason).toMatch(/lease/i);
  });

  it("completes trivially on an empty workflow", async () => {
    const result = await runWebWorkflow(workflow([]), async () => ok());
    expect(result).toEqual({ status: "completed", completedSteps: 0 });
  });
});
