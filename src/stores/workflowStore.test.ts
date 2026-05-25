/**
 * workflowStore tests — slice-by-slice coverage of the merged store.
 * Covers the behaviour previously asserted by ghaWorkflowPanelStore.test,
 * workflowEditStore.test, workflowPreviewStore.test, workflowViewStore.test,
 * and workflowApprovalStore.test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useWorkflowStore } from "./workflowStore";
import type { IRPatch } from "@/lib/ghaWorkflow/save/mutators";

beforeEach(() => {
  useWorkflowStore.getState().resetGha();
  useWorkflowStore.getState().resetPreview();
  useWorkflowStore.getState().resetView();
  useWorkflowStore.getState().resetEdit();
  useWorkflowStore.getState().resetApproval();
});

/* ──────────────────────────── gha slice ───────────────────────────────── */

describe("gha slice", () => {
  it("starts closed with empty workflow", () => {
    const s = useWorkflowStore.getState().gha;
    expect(s.panelOpen).toBe(false);
    expect(s.workflow).toBeNull();
    expect(s.parseError).toBeNull();
  });

  it("open/close/toggle panel", () => {
    useWorkflowStore.getState().ghaOpenPanel();
    expect(useWorkflowStore.getState().gha.panelOpen).toBe(true);
    useWorkflowStore.getState().ghaClosePanel();
    expect(useWorkflowStore.getState().gha.panelOpen).toBe(false);
    useWorkflowStore.getState().ghaTogglePanel();
    expect(useWorkflowStore.getState().gha.panelOpen).toBe(true);
  });

  it("setGhaWorkflow stores workflow and optional error", () => {
    useWorkflowStore.getState().setGhaWorkflow(null, "bad yaml");
    expect(useWorkflowStore.getState().gha.parseError).toBe("bad yaml");
    useWorkflowStore.getState().setGhaWorkflow(null);
    expect(useWorkflowStore.getState().gha.parseError).toBeNull();
  });
});

/* ────────────────────────── preview slice ─────────────────────────────── */

describe("preview slice", () => {
  it("starts with empty graph/status", () => {
    const s = useWorkflowStore.getState().preview;
    expect(s.panelOpen).toBe(false);
    expect(s.graph).toBeNull();
    expect(s.stepStatuses).toEqual({});
  });

  it("previewOpen/Close/Toggle panel are independent from gha", () => {
    useWorkflowStore.getState().previewOpenPanel();
    expect(useWorkflowStore.getState().preview.panelOpen).toBe(true);
    expect(useWorkflowStore.getState().gha.panelOpen).toBe(false);
  });

  it("setGraph clears active step and statuses", () => {
    useWorkflowStore.getState().setActiveStepId("s1");
    useWorkflowStore.getState().setStepStatus("s1", { status: "running" });
    useWorkflowStore
      .getState()
      .setGraph({ name: "n", steps: [] } as never);
    expect(useWorkflowStore.getState().preview.activeStepId).toBeNull();
    expect(useWorkflowStore.getState().preview.stepStatuses).toEqual({});
  });

  it("setExecution resets statuses", () => {
    useWorkflowStore.getState().setStepStatus("s1", { status: "running" });
    useWorkflowStore.getState().setExecution("exec-1");
    expect(useWorkflowStore.getState().preview.executionId).toBe("exec-1");
    expect(useWorkflowStore.getState().preview.stepStatuses).toEqual({});
  });

  it("setStepStatus accumulates per stepId", () => {
    useWorkflowStore.getState().setStepStatus("s1", { status: "running" });
    useWorkflowStore.getState().setStepStatus("s2", { status: "success" });
    expect(Object.keys(useWorkflowStore.getState().preview.stepStatuses).sort()).toEqual([
      "s1",
      "s2",
    ]);
  });
});

/* ──────────────────────────── view slice ──────────────────────────────── */

describe("view slice", () => {
  it("starts with no selection", () => {
    const s = useWorkflowStore.getState().view;
    expect(s.selectedJobId).toBeNull();
    expect(s.selectedStepId).toBeNull();
    expect(s.expandedMatrices.size).toBe(0);
    expect(s.layoutDirection).toBe("TD");
  });

  it("selectJob clears step selection", () => {
    useWorkflowStore.getState().selectStep("a", "b");
    useWorkflowStore.getState().selectJob("c");
    expect(useWorkflowStore.getState().view.selectedJobId).toBe("c");
    expect(useWorkflowStore.getState().view.selectedStepId).toBeNull();
  });

  it("selectStep sets both", () => {
    useWorkflowStore.getState().selectStep("a", "b");
    expect(useWorkflowStore.getState().view.selectedJobId).toBe("a");
    expect(useWorkflowStore.getState().view.selectedStepId).toBe("b");
  });

  it("clearSelection nulls both", () => {
    useWorkflowStore.getState().selectStep("a", "b");
    useWorkflowStore.getState().clearSelection();
    expect(useWorkflowStore.getState().view.selectedJobId).toBeNull();
    expect(useWorkflowStore.getState().view.selectedStepId).toBeNull();
  });

  it("toggleMatrix adds then removes", () => {
    useWorkflowStore.getState().toggleMatrix("j1");
    expect(useWorkflowStore.getState().view.expandedMatrices.has("j1")).toBe(true);
    useWorkflowStore.getState().toggleMatrix("j1");
    expect(useWorkflowStore.getState().view.expandedMatrices.has("j1")).toBe(false);
  });

  it("setLayoutDirection", () => {
    useWorkflowStore.getState().setLayoutDirection("LR");
    expect(useWorkflowStore.getState().view.layoutDirection).toBe("LR");
  });
});

/* ──────────────────────────── edit slice ──────────────────────────────── */

function mkSetPatch(path: string, value: unknown): IRPatch {
  return { kind: "workflow.set", path, value } as IRPatch;
}

describe("edit slice", () => {
  it("queuePatch appends", () => {
    useWorkflowStore.getState().queuePatch(mkSetPatch("name", "ci"));
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(1);
  });

  it("queuePatch dedupes same target — last-write-wins", () => {
    useWorkflowStore.getState().queuePatch(mkSetPatch("name", "a"));
    useWorkflowStore.getState().queuePatch(mkSetPatch("name", "b"));
    const q = useWorkflowStore.getState().edit.pendingPatches;
    expect(q).toHaveLength(1);
    expect((q[0] as { value: string }).value).toBe("b");
  });

  it("cancelPatchForTarget removes matching", () => {
    useWorkflowStore.getState().queuePatch(mkSetPatch("name", "a"));
    useWorkflowStore.getState().cancelPatchForTarget(mkSetPatch("name", "a"));
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
  });

  it("clearPatches empties queue", () => {
    useWorkflowStore.getState().queuePatch(mkSetPatch("name", "a"));
    useWorkflowStore.getState().clearPatches();
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
  });

  it("bindToDocument stashes per-doc queues", () => {
    useWorkflowStore.getState().bindToDocument("/doc1");
    useWorkflowStore.getState().queuePatch(mkSetPatch("name", "a"));
    useWorkflowStore.getState().bindToDocument("/doc2");
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
    useWorkflowStore.getState().bindToDocument("/doc1");
    expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(1);
  });

  it("applyAndSerialize returns input unchanged on empty queue", () => {
    const yaml = "name: ci\n";
    expect(useWorkflowStore.getState().applyAndSerialize(yaml)).toBe(yaml);
  });
});

/* ───────────────────────── approval slice ─────────────────────────────── */

describe("approval slice", () => {
  it("starts empty", () => {
    expect(useWorkflowStore.getState().approval.pending).toBeNull();
  });

  it("enqueue + dismiss", () => {
    useWorkflowStore.getState().enqueueApproval({
      executionId: "e1",
      stepId: "s1",
      summary: "genie/x",
      preview: "test",
      model: null,
    });
    expect(useWorkflowStore.getState().approval.pending?.executionId).toBe("e1");
    useWorkflowStore.getState().dismissApproval();
    expect(useWorkflowStore.getState().approval.pending).toBeNull();
  });
});
