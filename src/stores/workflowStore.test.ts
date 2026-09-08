// @vitest-environment node
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
  const sampleIr = (name: string) =>
    ({
      name,
      triggers: [],
      permissions: {},
      env: {},
      jobs: [],
      positions: {},
      diagnostics: [],
    }) as never;

  it("starts with no per-tab workflows", () => {
    expect(useWorkflowStore.getState().gha.byTab).toEqual({});
  });

  it("setGhaWorkflow keys the IR by tab", () => {
    useWorkflowStore.getState().setGhaWorkflow("t1", sampleIr("ci"));
    expect(useWorkflowStore.getState().gha.byTab["t1"]).toMatchObject({
      name: "ci",
    });
  });

  it("two tabs publish independently — no cross-tab clobbering (document split)", () => {
    useWorkflowStore.getState().setGhaWorkflow("t1", sampleIr("ci"));
    // A second pane holding plain YAML publishes null for ITS tab…
    useWorkflowStore.getState().setGhaWorkflow("t2", null);
    // …and the workflow pane's IR survives.
    expect(useWorkflowStore.getState().gha.byTab["t1"]).toMatchObject({
      name: "ci",
    });
    expect(useWorkflowStore.getState().gha.byTab["t2"]).toBeUndefined();
  });

  it("publishing null removes only that tab's entry", () => {
    useWorkflowStore.getState().setGhaWorkflow("t1", sampleIr("ci"));
    useWorkflowStore.getState().setGhaWorkflow("t2", sampleIr("release"));
    useWorkflowStore.getState().setGhaWorkflow("t1", null);
    expect(useWorkflowStore.getState().gha.byTab["t1"]).toBeUndefined();
    expect(useWorkflowStore.getState().gha.byTab["t2"]).toMatchObject({
      name: "release",
    });
  });

  it("resetGha clears everything", () => {
    useWorkflowStore.getState().setGhaWorkflow("t1", sampleIr("ci"));
    useWorkflowStore.getState().resetGha();
    expect(useWorkflowStore.getState().gha.byTab).toEqual({});
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

  it("previewOpen/Close/Toggle panel leave the gha slice untouched", () => {
    useWorkflowStore.getState().previewOpenPanel();
    expect(useWorkflowStore.getState().preview.panelOpen).toBe(true);
    expect(useWorkflowStore.getState().gha.byTab).toEqual({});
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

/** A patch with a DIFFERENT target from mkSetPatch, so `dedupQueue` keeps both. */
function mkConcurrencyPatch(value: string): IRPatch {
  return { kind: "workflow.concurrency.set", value } as IRPatch;
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

  // Audit 20260907 (#292): a Save As renames the document its patches belong
  // to. `bindToDocument` cannot express that — it stashes the old id's queue
  // and restores the new id's, leaving the edits under a name nothing saves.
  describe("renameDocument carries a queue to a new id", () => {
    it("moves the bound document's queue and the binding with it", () => {
      useWorkflowStore.getState().bindToDocument("untitled:tab-1");
      useWorkflowStore.getState().queuePatch(mkSetPatch("name", "a"));

      useWorkflowStore.getState().renameDocument("untitled:tab-1", "/repo/ci.yml");

      const { edit } = useWorkflowStore.getState();
      expect(edit.boundDocumentId).toBe("/repo/ci.yml");
      expect(edit.pendingPatches).toHaveLength(1);
      expect(edit.patchesByDocument["untitled:tab-1"]).toBeUndefined();
      expect(edit.patchesByDocument["/repo/ci.yml"]).toHaveLength(1);
    });

    it("moves a STASHED queue while another document keeps the binding", () => {
      useWorkflowStore.getState().bindToDocument("untitled:tab-1");
      useWorkflowStore.getState().queuePatch(mkSetPatch("name", "mine"));
      useWorkflowStore.getState().bindToDocument("/repo/other.yml");
      useWorkflowStore.getState().queuePatch(mkSetPatch("name", "theirs"));

      useWorkflowStore.getState().renameDocument("untitled:tab-1", "/repo/new.yml");

      const { edit } = useWorkflowStore.getState();
      expect(edit.boundDocumentId).toBe("/repo/other.yml");
      expect(edit.pendingPatches).toEqual([mkSetPatch("name", "theirs")]);
      expect(edit.patchesByDocument["/repo/new.yml"]).toEqual([mkSetPatch("name", "mine")]);
      expect(edit.patchesByDocument["untitled:tab-1"]).toBeUndefined();
    });

    it("appends behind a queue the destination already had, rather than replacing it", () => {
      useWorkflowStore.getState().bindToDocument("/repo/new.yml");
      useWorkflowStore.getState().queuePatch(mkConcurrencyPatch("theirs"));
      useWorkflowStore.getState().bindToDocument("untitled:tab-1");
      useWorkflowStore.getState().queuePatch(mkSetPatch("name", "mine"));

      useWorkflowStore.getState().renameDocument("untitled:tab-1", "/repo/new.yml");

      expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
        mkConcurrencyPatch("theirs"),
        mkSetPatch("name", "mine"),
      ]);
    });

    it("still moves the binding when the renamed document has nothing queued", () => {
      useWorkflowStore.getState().bindToDocument("untitled:tab-1");
      useWorkflowStore.getState().renameDocument("untitled:tab-1", "/repo/new.yml");
      const { edit } = useWorkflowStore.getState();
      expect(edit.boundDocumentId).toBe("/repo/new.yml");
      expect(edit.pendingPatches).toEqual([]);
      expect(edit.patchesByDocument["/repo/new.yml"]).toBeUndefined();
    });

    it("leaves everything alone for an unknown source, or a rename to the same id", () => {
      useWorkflowStore.getState().bindToDocument("/repo/ci.yml");
      useWorkflowStore.getState().queuePatch(mkSetPatch("name", "a"));
      const before = useWorkflowStore.getState().edit;

      useWorkflowStore.getState().renameDocument("untitled:nobody", "/repo/elsewhere.yml");
      useWorkflowStore.getState().renameDocument("/repo/ci.yml", "/repo/ci.yml");

      expect(useWorkflowStore.getState().edit).toBe(before);
    });
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

describe("workflowStore — run outcome and approval scoping (audit round 2)", () => {
  beforeEach(() => {
    useWorkflowStore.getState().resetPreview();
    useWorkflowStore.getState().resetApproval();
  });

  // #767 — `setExecution(null)` cleared every step status at the moment the run
  // ended, so the canvas lost its success/failure colouring exactly when the
  // user wanted to read it, and completed/failed/cancelled became identical.
  it("finishExecution keeps the step statuses and records the outcome", () => {
    const store = useWorkflowStore.getState();
    store.setExecution("run-1");
    store.setStepStatus("build", { status: "success" });

    store.finishExecution("run-1", "completed");

    const preview = useWorkflowStore.getState().preview;
    expect(preview.executionId).toBeNull();
    expect(preview.lastRunOutcome).toBe("completed");
    expect(preview.stepStatuses.build?.status).toBe("success");
  });

  it("finishExecution for a stale run does not end the live one", () => {
    const store = useWorkflowStore.getState();
    store.setExecution("run-1");
    store.finishExecution("run-0", "cancelled");
    expect(useWorkflowStore.getState().preview.executionId).toBe("run-1");
    expect(useWorkflowStore.getState().preview.lastRunOutcome).toBeNull();
  });

  it("starting a run clears the previous outcome and its statuses", () => {
    const store = useWorkflowStore.getState();
    store.setExecution("run-1");
    store.setStepStatus("build", { status: "error" });
    store.finishExecution("run-1", "failed");

    store.setExecution("run-2");

    const preview = useWorkflowStore.getState().preview;
    expect(preview.lastRunOutcome).toBeNull();
    expect(preview.stepStatuses).toEqual({});
  });

  // #1009 — the runner emits the NEXT step's approval-request while
  // `respond_workflow_approval` is still resolving; the two travel on different
  // channels with no ordering, so an unscoped dismiss after a verdict can wipe
  // a request the user never saw.
  it("a scoped dismissApproval leaves a newer pending request alone", () => {
    const store = useWorkflowStore.getState();
    const first = { executionId: "run-1", stepId: "s1", summary: "a", preview: "a" };
    const second = { executionId: "run-1", stepId: "s2", summary: "b", preview: "b" };
    store.enqueueApproval(first);
    store.enqueueApproval(second);

    store.dismissApproval(first);

    expect(useWorkflowStore.getState().approval.pending).toEqual(second);

    store.dismissApproval(second);
    expect(useWorkflowStore.getState().approval.pending).toBeNull();
  });

  it("an unscoped dismissApproval still clears whatever is pending", () => {
    const store = useWorkflowStore.getState();
    store.enqueueApproval({ executionId: "run-1", stepId: "s1", summary: "a", preview: "a" });
    store.dismissApproval();
    expect(useWorkflowStore.getState().approval.pending).toBeNull();
  });
});

/* ─────────────── serialization outcomes + queue transitions ────────────── */

const CI_YAML = "name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n";

function setPatch(path: string, value: unknown): IRPatch {
  return { kind: "workflow.set", path, value } as IRPatch;
}

// Audit #991/#1006 — every failure used to be spelled "the text came back
// unchanged", which is also how a legitimate no-op is spelled. A caller could
// not tell a document that will NEVER save from one with nothing to do, and the
// queue sat pending forever either way.
describe("serializeWorkflowEdits reports WHICH outcome", () => {
  beforeEach(() => {
    useWorkflowStore.getState().bindToDocument("/repo/ci.yml");
  });

  it("reports no-patches for an empty queue", () => {
    expect(useWorkflowStore.getState().serializeWorkflowEdits(CI_YAML)).toEqual({
      status: "no-patches",
    });
  });

  it("reports applied, with the new text, for a real edit", () => {
    useWorkflowStore.getState().queuePatch(setPatch("name", "release"));

    const result = useWorkflowStore.getState().serializeWorkflowEdits(CI_YAML, "/repo/ci.yml");

    expect(result.status).toBe("applied");
    expect(result.status === "applied" && result.yaml).toContain("release");
  });

  it("reports unchanged — not a failure — when the edit writes the same value", () => {
    useWorkflowStore.getState().queuePatch(setPatch("name", "ci"));

    expect(
      useWorkflowStore.getState().serializeWorkflowEdits(CI_YAML, "/repo/ci.yml"),
    ).toEqual({ status: "unchanged" });
  });

  it("reports parse-failed, with a detail, for a document that does not parse", () => {
    useWorkflowStore.getState().queuePatch(setPatch("name", "release"));

    const result = useWorkflowStore
      .getState()
      .serializeWorkflowEdits("name: [unclosed\n  bad: : :\n", "/repo/ci.yml");

    expect(result.status).toBe("parse-failed");
    expect(result.status === "parse-failed" && result.detail).toBeTruthy();
  });

  it("reports wrong-document, naming the binding, for another pane's queue", () => {
    useWorkflowStore.getState().queuePatch(setPatch("name", "release"));

    expect(
      useWorkflowStore.getState().serializeWorkflowEdits(CI_YAML, "/repo/other.yml"),
    ).toEqual({ status: "wrong-document", boundDocumentId: "/repo/ci.yml" });
  });

  it("applyAndSerialize collapses every non-applied outcome to the input", () => {
    useWorkflowStore.getState().queuePatch(setPatch("name", "release"));
    const store = useWorkflowStore.getState();

    expect(store.applyAndSerialize(CI_YAML, "/repo/other.yml")).toBe(CI_YAML);
    expect(store.applyAndSerialize("name: [unclosed\n  bad: : :\n", "/repo/ci.yml")).toBe(
      "name: [unclosed\n  bad: : :\n",
    );
    expect(store.applyAndSerialize(CI_YAML, "/repo/ci.yml")).toContain("release");
  });
});

// Audit #1004 — `mirrorActiveQueue` deliberately skips the stash while nothing
// is bound, so those patches lived only in `pendingPatches`; the first bind
// then replaced them with the incoming document's stash and they were gone,
// with no signal of any kind.
describe("binding a document adopts an unbound queue", () => {
  it("carries patches queued before any document was bound", () => {
    expect(useWorkflowStore.getState().edit.boundDocumentId).toBeNull();
    useWorkflowStore.getState().queuePatch(setPatch("name", "release"));

    useWorkflowStore.getState().bindToDocument("/repo/ci.yml");

    const { edit } = useWorkflowStore.getState();
    expect(edit.pendingPatches).toHaveLength(1);
    expect(edit.patchesByDocument["/repo/ci.yml"]).toHaveLength(1);
    expect(
      useWorkflowStore.getState().serializeWorkflowEdits(CI_YAML, "/repo/ci.yml").status,
    ).toBe("applied");
  });

  it("keeps the incoming document's own queue first, orphans after", () => {
    useWorkflowStore.getState().bindToDocument("/repo/ci.yml");
    useWorkflowStore.getState().queuePatch(setPatch("name", "stashed"));
    useWorkflowStore.getState().bindToDocument(null);
    useWorkflowStore.getState().queuePatch(setPatch("run-name", "orphan"));

    useWorkflowStore.getState().bindToDocument("/repo/ci.yml");

    const paths = useWorkflowStore
      .getState()
      .edit.pendingPatches.map((p) => (p as { path: string }).path);
    expect(paths).toEqual(["name", "run-name"]);
  });

  it("dedups an orphan against the same target already stashed", () => {
    useWorkflowStore.getState().bindToDocument("/repo/ci.yml");
    useWorkflowStore.getState().queuePatch(setPatch("name", "old"));
    useWorkflowStore.getState().bindToDocument(null);
    useWorkflowStore.getState().queuePatch(setPatch("name", "new"));

    useWorkflowStore.getState().bindToDocument("/repo/ci.yml");

    const queue = useWorkflowStore.getState().edit.pendingPatches;
    expect(queue).toHaveLength(1);
    expect((queue[0] as { value: unknown }).value).toBe("new");
  });
});

// Audit #1002 proposed clearing `executionId` here. The code refutes it, and
// this test pins the refutation: the only production caller of `setGraph` is
// the source pane's debounced re-parse, which fires on every keystroke in a
// workflow file — including during a run. `finishExecution` matches on the id,
// so clearing it would leave a live run unfinishable and its outcome lost.
describe("setGraph during a run", () => {
  it("keeps executionId so the run can still be finished", () => {
    useWorkflowStore.getState().setExecution("exec-1");

    useWorkflowStore.getState().setGraph({ name: "n", steps: [] } as never);
    expect(useWorkflowStore.getState().preview.executionId).toBe("exec-1");

    useWorkflowStore.getState().finishExecution("exec-1", "completed");
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
    expect(useWorkflowStore.getState().preview.lastRunOutcome).toBe("completed");
  });
});
