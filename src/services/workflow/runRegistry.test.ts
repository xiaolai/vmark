// @vitest-environment node
// WI-NB6.2 — the run registry: runId → live state, one run per tab, and the
// per-(tab, sourceHash) completed-write ledger that refuses a re-run from
// re-executing a write step that already succeeded (Codex review A2/CO... the
// "re-run refusal" that did not exist in v1).
import { describe, it, expect, beforeEach } from "vitest";
import {
  createRun,
  getRun,
  updateRun,
  hasLiveRun,
  writeStepAlreadyDone,
  markWriteStepDone,
  __resetRunRegistry,
} from "./runRegistry";

beforeEach(() => __resetRunRegistry());

describe("createRun / getRun", () => {
  it("creates a running record and returns a unique id", () => {
    const a = createRun({ tabId: "t1", sourceHash: "h1", stepCount: 3, deadlineAt: 100 });
    const b = createRun({ tabId: "t2", sourceHash: "h1", stepCount: 3, deadlineAt: 100 });
    expect(a.runId).not.toBe(b.runId);
    expect(getRun(a.runId)).toMatchObject({ status: "running", completedSteps: 0, tabId: "t1" });
  });

  it("returns null for an unknown run", () => {
    expect(getRun("nope")).toBeNull();
  });
});

describe("one live run per tab", () => {
  it("reports a live run and rejects a second on the same tab", () => {
    createRun({ tabId: "t1", sourceHash: "h1", stepCount: 1, deadlineAt: 100 });
    expect(hasLiveRun("t1")).toBe(true);
    expect(hasLiveRun("t2")).toBe(false);
  });

  it("frees the tab once the run reaches a terminal status", () => {
    const r = createRun({ tabId: "t1", sourceHash: "h1", stepCount: 1, deadlineAt: 100 });
    updateRun(r.runId, { status: "completed" });
    expect(hasLiveRun("t1")).toBe(false);
  });
});

describe("completed-write ledger (re-run refusal)", () => {
  it("remembers a completed write step across runs of the same (tab, source)", () => {
    markWriteStepDone("t1", "h1", "step-2");
    expect(writeStepAlreadyDone("t1", "h1", "step-2")).toBe(true);
    // A different source, tab, or step is unaffected.
    expect(writeStepAlreadyDone("t1", "h2", "step-2")).toBe(false);
    expect(writeStepAlreadyDone("t2", "h1", "step-2")).toBe(false);
    expect(writeStepAlreadyDone("t1", "h1", "step-3")).toBe(false);
  });
});
