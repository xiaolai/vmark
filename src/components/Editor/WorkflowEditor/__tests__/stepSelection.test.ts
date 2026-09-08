// @vitest-environment node
// Audit 20260907 (#283) — the selected job/step derivation WorkflowEditorPanel
// used to compute inline, as a pure function over the preview IR.
import { describe, expect, it } from "vitest";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { selectStepContext } from "../stepSelection";

const pos = { startLine: 1, startCol: 1, endLine: 1, endCol: 1 };
const step = (id: string) => ({ id, position: pos });
const workflow: WorkflowIR = {
  triggers: [],
  permissions: {},
  env: {},
  jobs: [
    { id: "build", needs: [], steps: [step("s1"), step("s2"), step("s3")], position: pos },
    { id: "deploy", needs: [], steps: [], position: pos },
  ],
  positions: {},
  diagnostics: [],
} as unknown as WorkflowIR;

describe("selectStepContext", () => {
  it("nothing selected → no job, no step", () => {
    expect(selectStepContext(workflow, null, null)).toEqual({
      selectedJob: null,
      selectedStep: null,
      selectedStepIndex: -1,
      stepCount: 0,
      prevStepId: null,
      nextStepId: null,
    });
  });

  it("a job alone → the job and its step count, no step", () => {
    const ctx = selectStepContext(workflow, "build", null);
    expect(ctx.selectedJob?.id).toBe("build");
    expect(ctx.selectedStep).toBeNull();
    expect(ctx.selectedStepIndex).toBe(-1);
    expect(ctx.stepCount).toBe(3);
    expect(ctx.prevStepId).toBeNull();
    expect(ctx.nextStepId).toBeNull();
  });

  it("a middle step → both neighbours", () => {
    const ctx = selectStepContext(workflow, "build", "s2");
    expect(ctx.selectedStep?.id).toBe("s2");
    expect(ctx.selectedStepIndex).toBe(1);
    expect(ctx.prevStepId).toBe("s1");
    expect(ctx.nextStepId).toBe("s3");
  });

  it("the first and last steps have one neighbour each", () => {
    expect(selectStepContext(workflow, "build", "s1")).toMatchObject({ prevStepId: null, nextStepId: "s2" });
    expect(selectStepContext(workflow, "build", "s3")).toMatchObject({ prevStepId: "s2", nextStepId: null });
  });

  it("a step id that is not in the selected job → the job without a step", () => {
    const ctx = selectStepContext(workflow, "deploy", "s1");
    expect(ctx.selectedJob?.id).toBe("deploy");
    expect(ctx.selectedStep).toBeNull();
    expect(ctx.stepCount).toBe(0);
  });

  it("an unknown job id → nothing, even with a step id", () => {
    expect(selectStepContext(workflow, "ghost", "s1").selectedJob).toBeNull();
  });
});

// Audit R3 #582 — the empty result is ONE shared object.
describe("selectStepContext — the empty result cannot be corrupted", () => {
  it("refuses a write to the shared empty context", () => {
    const empty = selectStepContext(workflow, null, null) as {
      selectedStepIndex: number;
    };
    expect(() => {
      empty.selectedStepIndex = 7;
    }).toThrow(TypeError);
  });

  it("still answers -1 for the next caller", () => {
    selectStepContext(workflow, null, null);
    expect(selectStepContext(workflow, null, null).selectedStepIndex).toBe(-1);
  });
});
