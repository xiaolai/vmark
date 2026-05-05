// WI-C0 — preview IR overlay tests.

import { describe, it, expect } from "vitest";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import type { IRPatch } from "./mutators";
import { applyPreviewPatches } from "./previewIR";

function makeIR(): WorkflowIR {
  return {
    triggers: [
      {
        event: "push",
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    permissions: undefined,
    env: {},
    jobs: [
      {
        id: "build",
        runsOn: ["ubuntu-latest"],
        needs: [],
        steps: [
          {
            id: "checkout",
            idSynthesized: false,
            uses: "actions/checkout@v4",
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          },
          {
            id: "test",
            idSynthesized: false,
            run: "pnpm test",
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          },
        ],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    positions: {},
    diagnostics: [],
  } as WorkflowIR;
}

describe("applyPreviewPatches", () => {
  it("returns the original IR when there are no patches", () => {
    const ir = makeIR();
    expect(applyPreviewPatches(ir, [])).toBe(ir);
  });

  it("content patches DO change IR (Codex audit HIGH-3 — fresh entities preserve user edits)", () => {
    const ir = makeIR();
    const patches: IRPatch[] = [
      { kind: "job.set", jobId: "build", path: "name", value: "Renamed" },
      {
        kind: "with.set",
        jobId: "build",
        stepIndex: 0,
        key: "ref",
        value: "main",
      },
    ];
    const out = applyPreviewPatches(ir, patches);
    expect(out).not.toBe(ir);
    const buildJob = out.jobs.find((j) => j.id === "build")!;
    expect(buildJob.name).toBe("Renamed");
    expect(buildJob.steps[0].with).toEqual({ ref: "main" });
  });

  it("trigger.setFilters / permissions.set / concurrency.set return ir reference (form-local state suffices)", () => {
    const ir = makeIR();
    const patches: IRPatch[] = [
      {
        kind: "workflow.permissions.set",
        value: "read-all",
      },
    ];
    expect(applyPreviewPatches(ir, patches)).toBe(ir);
  });

  it("job.create adds a synthetic job to the preview", () => {
    const ir = makeIR();
    const out = applyPreviewPatches(ir, [
      { kind: "job.create", jobId: "lint", runsOn: "macos-latest" },
    ]);
    expect(out.jobs).toHaveLength(2);
    const lint = out.jobs.find((j) => j.id === "lint");
    expect(lint?.runsOn).toEqual(["macos-latest"]);
    expect(lint?.steps).toEqual([]);
  });

  it("job.delete filters the job out", () => {
    const ir = makeIR();
    const out = applyPreviewPatches(ir, [
      { kind: "job.delete", jobId: "build" },
    ]);
    expect(out.jobs).toHaveLength(0);
  });

  it("step.insert adds a step at the requested index", () => {
    const ir = makeIR();
    const out = applyPreviewPatches(ir, [
      {
        kind: "step.insert",
        jobId: "build",
        index: 1,
        step: { name: "Lint", run: "pnpm lint" },
      },
    ]);
    const buildJob = out.jobs.find((j) => j.id === "build")!;
    expect(buildJob.steps).toHaveLength(3);
    expect(buildJob.steps[1].name).toBe("Lint");
  });

  it("step.delete removes the step", () => {
    const ir = makeIR();
    const out = applyPreviewPatches(ir, [
      { kind: "step.delete", jobId: "build", stepIndex: 0 },
    ]);
    const buildJob = out.jobs.find((j) => j.id === "build")!;
    expect(buildJob.steps).toHaveLength(1);
    expect(buildJob.steps[0].id).toBe("test");
  });

  it("step.move reorders within the job", () => {
    const ir = makeIR();
    const out = applyPreviewPatches(ir, [
      { kind: "step.move", jobId: "build", fromIndex: 0, toIndex: 1 },
    ]);
    const buildJob = out.jobs.find((j) => j.id === "build")!;
    expect(buildJob.steps[0].id).toBe("test");
    expect(buildJob.steps[1].id).toBe("checkout");
  });

  it("multiple ops apply in sequence", () => {
    const ir = makeIR();
    const out = applyPreviewPatches(ir, [
      { kind: "job.create", jobId: "lint" },
      {
        kind: "step.insert",
        jobId: "lint",
        index: 0,
        step: { run: "pnpm lint" },
      },
    ]);
    const lint = out.jobs.find((j) => j.id === "lint")!;
    expect(lint.steps).toHaveLength(1);
    expect(lint.steps[0].run).toBe("pnpm lint");
  });

  it("does not mutate the input IR", () => {
    const ir = makeIR();
    applyPreviewPatches(ir, [
      { kind: "step.delete", jobId: "build", stepIndex: 0 },
    ]);
    expect(ir.jobs[0].steps).toHaveLength(2);
  });
});
