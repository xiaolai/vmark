// @vitest-environment node
// WI-NB6.2 — the run registry: runId → live state, one run per tab, and the
// per-(tab, ledgerId) completed-write ledger that refuses a re-run from
// re-executing a write step that already succeeded (Codex review A2/CO... the
// "re-run refusal" that did not exist in v1).
// Audit 2026-09-03 W-05/W-07/W-08/W-09: a paused run frees its tab, one step
// result per step with attempts folded, pendingApproval, lease ownership, and
// the per-run abort controller.
import { describe, it, expect, beforeEach } from "vitest";
import {
  claimLease,
  createRun,
  getRun,
  getRunAbort,
  hasLiveRun,
  isTerminalStatus,
  __leaseOwnerRunId,
  markWriteStepDone,
  noteStepAttempt,
  noteStepResult,
  registerRunAbort,
  releaseLeaseClaim,
  setPendingApproval,
  updateRun,
  writeStepAlreadyDone,
  __resetRunRegistry,
} from "./runRegistry";

beforeEach(() => __resetRunRegistry());

const base = { sourceHash: "h1", inputsHash: "i1", stepCount: 3, firstStep: "step-1" };

describe("createRun / getRun", () => {
  it("creates a running record and returns a unique id", () => {
    const a = createRun({ tabId: "t1", ...base });
    const b = createRun({ tabId: "t2", ...base });
    expect(a.runId).not.toBe(b.runId);
    expect(getRun(a.runId)).toMatchObject({
      status: "running",
      completedSteps: 0,
      skippedSteps: 0,
      tabId: "t1",
      firstStep: "step-1",
      stepResults: [],
    });
  });

  it("records what a resumed run continues from", () => {
    const old = createRun({ tabId: "t1", ...base });
    updateRun(old.runId, { status: "paused" });
    const next = createRun({ tabId: "t1", ...base, resumedFrom: old.runId });
    expect(getRun(next.runId)?.resumedFrom).toBe(old.runId);
  });

  it("returns null for an unknown run", () => {
    expect(getRun("nope")).toBeNull();
  });
});

describe("one live run per tab", () => {
  it("reports a live run and rejects a second on the same tab", () => {
    createRun({ tabId: "t1", ...base });
    expect(hasLiveRun("t1")).toBe(true);
    expect(hasLiveRun("t2")).toBe(false);
  });

  it("frees the tab once the run reaches a terminal status", () => {
    const r = createRun({ tabId: "t1", ...base });
    updateRun(r.runId, { status: "completed" });
    expect(hasLiveRun("t1")).toBe(false);
  });

  it("frees the tab when the run PAUSES — a paused run must not block its own resume (W-05)", () => {
    const r = createRun({ tabId: "t1", ...base });
    updateRun(r.runId, { status: "paused", pausedAt: "step-2" });
    expect(hasLiveRun("t1")).toBe(false);
    expect(isTerminalStatus("paused")).toBe(false);
  });

  it("knows which statuses are terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("superseded")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
  });
});

describe("step results (W-09): one entry per step, attempts folded", () => {
  it("folds attempts into one entry and counts completed/skipped distinctly", () => {
    const r = createRun({ tabId: "t1", ...base });
    noteStepAttempt(r.runId, 1);
    noteStepResult(r.runId, 1, { status: "failed", reason: "obscured" });
    noteStepAttempt(r.runId, 1);
    noteStepResult(r.runId, 1, { status: "success" });
    noteStepResult(r.runId, 2, { status: "skipped", reason: "already-completed" });
    noteStepAttempt(r.runId, 3);
    const state = getRun(r.runId)!;
    expect(state.stepResults).toEqual([
      { index: 1, status: "success", attempts: 2 },
      { index: 2, status: "skipped", attempts: 0, reason: "already-completed" },
      { index: 3, status: "running", attempts: 1 },
    ]);
    expect(state.completedSteps).toBe(1);
    expect(state.skippedSteps).toBe(1);
  });

  it("keeps step data (an extract's reader summary) and drops a stale reason on success", () => {
    const r = createRun({ tabId: "t1", ...base });
    noteStepAttempt(r.runId, 1);
    noteStepResult(r.runId, 1, { status: "failed", reason: "not-found" });
    noteStepAttempt(r.runId, 1);
    noteStepResult(r.runId, 1, { status: "success", data: { title: "T", textLength: 3, truncated: false } });
    expect(getRun(r.runId)!.stepResults[0]).toEqual({
      index: 1,
      status: "success",
      attempts: 2,
      data: { title: "T", textLength: 3, truncated: false },
    });
  });

  it("orders entries by step index whatever the recording order", () => {
    const r = createRun({ tabId: "t1", ...base });
    noteStepResult(r.runId, 3, { status: "skipped", reason: "already-completed" });
    noteStepAttempt(r.runId, 1);
    expect(getRun(r.runId)!.stepResults.map((s) => s.index)).toEqual([1, 3]);
  });

  it("ignores an unknown run", () => {
    expect(() => noteStepAttempt("nope", 1)).not.toThrow();
    expect(() => noteStepResult("nope", 1, { status: "success" })).not.toThrow();
  });
});

describe("pendingApproval (W-09)", () => {
  it("is set while a prompt is open and cleared after", () => {
    const r = createRun({ tabId: "t1", ...base });
    setPendingApproval(r.runId, { operation: "click", url: "https://x.test", target: { role: "button", name: "Go" } });
    expect(getRun(r.runId)!.pendingApproval).toEqual({
      operation: "click",
      url: "https://x.test",
      target: { role: "button", name: "Go" },
    });
    setPendingApproval(r.runId, null);
    expect(getRun(r.runId)!.pendingApproval).toBeUndefined();
    expect("pendingApproval" in getRun(r.runId)!).toBe(false);
  });
});

describe("lease ownership (W-08): the lease is released only by the run that holds it", () => {
  it("records the owner and lets only that run release the claim", () => {
    const a = createRun({ tabId: "t1", ...base });
    claimLease("t1", a.runId);
    expect(__leaseOwnerRunId("t1")).toBe(a.runId);
    expect(releaseLeaseClaim("t1", "someone-else")).toBe(false);
    expect(__leaseOwnerRunId("t1")).toBe(a.runId);
    expect(releaseLeaseClaim("t1", a.runId)).toBe(true);
    expect(__leaseOwnerRunId("t1")).toBeNull();
    expect(releaseLeaseClaim("t1", a.runId)).toBe(false);
  });
});

describe("abort controller per run (W-01)", () => {
  it("stores and returns the run's controller", () => {
    const r = createRun({ tabId: "t1", ...base });
    const ctrl = new AbortController();
    registerRunAbort(r.runId, ctrl);
    expect(getRunAbort(r.runId)).toBe(ctrl);
    expect(getRunAbort("nope")).toBeNull();
  });
});

describe("completed-write ledger (re-run refusal)", () => {
  it("remembers a completed write step across runs of the same (tab, ledgerId)", () => {
    markWriteStepDone("t1", "h1+i1", "step-2");
    expect(writeStepAlreadyDone("t1", "h1+i1", "step-2")).toBe(true);
    // A different ledger (source OR inputs), tab, or step is unaffected.
    expect(writeStepAlreadyDone("t1", "h2+i1", "step-2")).toBe(false);
    expect(writeStepAlreadyDone("t1", "h1+i2", "step-2")).toBe(false);
    expect(writeStepAlreadyDone("t2", "h1+i1", "step-2")).toBe(false);
    expect(writeStepAlreadyDone("t1", "h1+i1", "step-3")).toBe(false);
  });
});
