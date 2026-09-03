// @vitest-environment jsdom
// WI-NB6.2/6.3 — the run orchestrator: validate → acquire lease → run detached
// → status/cancel. The run does not live inside the starting request (Codex
// review: the bridge bounds a request at ~20s).
// Audit 2026-09-03 W-01/W-04/W-05/W-06/W-07/W-08/W-09: cancel and takeover
// interrupt an approval wait; a paused run releases the lease and the human hold;
// explicit resume; the running-time deadline; the source+inputs ledger; terminal
// cancel semantics; the D1v2 status contract.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const mint = vi.fn();
vi.mock("@/services/browser/grantSync", () => ({
  mintOneShotConfirmed: (...a: unknown[]) => mint(...a),
}));

import { startWorkflowRun, workflowRunStatus, cancelWorkflowRun } from "./workflowRunService";
import { __resetRunRegistry } from "./runRegistry";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserLeaseStore } from "@/services/browser/lease";

const TAB = "tab-1";
const URL = "https://blog.example.com/";
const ORIGIN = "https://blog.example.com";

const SOURCE = ["---", "site: blog", "inputs: [title]", "---", '1. action: click "Publish" (button)'].join("\n");
const TWO_STEP = ["---", "site: blog", "inputs: [title]", "---", '1. action: type {title} into "Title" (textbox)', '2. action: click "Publish" (button)'].join("\n");

function resolveTab() {
  return { url: URL, generation: 1 };
}

function baseCtx(over = {}) {
  return { tabId: TAB, resolveTab, inputs: { title: "x" }, deadlineMs: 120000, pollMs: 1, ...over };
}

/** Drain microtasks so the detached run settles. */
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
/** Let the approval poll loop (pollMs 1) turn a few times. */
const tick = () => new Promise((r) => setTimeout(r, 10));

const actCalls = () => invoke.mock.calls.filter((c) => c[0] === "browser_eval" && (c[1] as { operation?: string }).operation !== "read");
const runPrompt = (runId: string) => useBrowserApprovalStore.getState().pending.find((p) => p.runId === runId);

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(JSON.stringify({ found: true, clicked: true, typed: true }));
  mint.mockReset().mockResolvedValue(true);
  __resetRunRegistry();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
  useBrowserLeaseStore.setState({ leases: {}, inflightCancel: {} });
});

describe("startWorkflowRun", () => {
  it("returns a runId and firstStep immediately and acquires the AI lease", () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    const res = startWorkflowRun(SOURCE, baseCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.runId).toMatch(/^wfrun-/);
    expect(res.firstStep).toBe("step-1");
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai");
    expect(workflowRunStatus(res.runId)).toMatchObject({ status: "running", firstStep: "step-1", stepCount: 1 });
  });

  it("rejects a malformed source with parse diagnostics and takes no lease", () => {
    const res = startWorkflowRun("no front matter here", baseCtx());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/parse|site/i);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("refuses a missing input and an undeclared extra input (W-09)", () => {
    expect(startWorkflowRun(SOURCE, baseCtx({ inputs: {} })).ok).toBe(false);
    const extra = startWorkflowRun(SOURCE, baseCtx({ inputs: { title: "x", bogus: "y" } }));
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.error).toMatch(/undeclared input "bogus"/);
  });

  it("refuses a second run on a busy tab", () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    const first = startWorkflowRun(SOURCE, baseCtx());
    expect(first.ok).toBe(true);
    const second = startWorkflowRun(SOURCE, baseCtx());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/already/i);
  });

  it("runs to completion, releases the lease, and reports one result per step", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    const res = startWorkflowRun(SOURCE, baseCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await flush();
    const st = workflowRunStatus(res.runId)!;
    expect(st.status).toBe("completed");
    expect(st.completedSteps).toBe(1);
    expect(st.skippedSteps).toBe(0);
    expect(st.stepResults).toEqual([{ index: 1, status: "success", attempts: 1 }]);
    expect(st.pendingApproval).toBeUndefined();
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("pauses on a goal step and reports where — and RELEASES the lease (W-04/W-05)", async () => {
    const src = ["---", "site: blog", "---", "1. goal: find my dashboard"].join("\n");
    const res = startWorkflowRun(src, baseCtx({ inputs: {} }));
    if (!res.ok) return;
    await flush();
    const st = workflowRunStatus(res.runId);
    expect(st?.status).toBe("paused");
    expect(st?.pausedAt).toBe("step-1");
    expect(st?.reasonCode).toBe("needs-human");
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
    // …so a new run may start on the tab (the documented resume path).
    expect(startWorkflowRun(src, baseCtx({ inputs: {} })).ok).toBe(true);
  });

  it("keeps the extract summary as step data (W-09)", async () => {
    invoke.mockResolvedValue(JSON.stringify({ html: "<html><head><title>T</title></head><body><article><h1>T</h1><p>hello world text</p></article></body></html>", truncated: false }));
    const src = ["---", "site: blog", "---", "1. extract: the body"].join("\n");
    const res = startWorkflowRun(src, baseCtx({ inputs: {} }));
    if (!res.ok) return;
    await flush();
    expect(workflowRunStatus(res.runId)?.stepResults[0]).toMatchObject({ index: 1, status: "success", data: { title: "T", truncated: false } });
  });
});

describe("approval waits: cancel and takeover interrupt them (W-01)", () => {
  it("mirrors the open prompt as pendingApproval and pauses the clock while it is open (W-06/W-09)", async () => {
    let t = 0;
    const res = startWorkflowRun(SOURCE, baseCtx({ now: () => t, deadlineMs: 1_000 }));
    if (!res.ok) return;
    await tick();
    expect(workflowRunStatus(res.runId)?.pendingApproval).toEqual({ operation: "click", url: ORIGIN, target: { role: "button", name: "Publish" } });
    t = 500_000; // the user thinks for a long time — excluded from the budget
    useBrowserApprovalStore.getState().resolveApproval(runPrompt(res.runId)!.id, "once");
    await tick();
    await flush();
    const st = workflowRunStatus(res.runId)!;
    expect(st.status).toBe("completed");
    expect(st.pendingApproval).toBeUndefined();
  });

  it("human takeover during the wait: the prompt is withdrawn, nothing acts, the run pauses lease-lost, the hold is cleared", async () => {
    const res = startWorkflowRun(SOURCE, baseCtx());
    if (!res.ok) return;
    await tick();
    const prompt = runPrompt(res.runId)!;
    expect(prompt).toBeDefined();
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    await tick();
    await flush();
    expect(runPrompt(res.runId)).toBeUndefined(); // withdrawn, not orphaned
    expect(workflowRunStatus(res.runId)).toMatchObject({ status: "paused", reasonCode: "lease-lost" });
    // The user answers the stale prompt anyway (a no-op) or a grant appears later.
    useBrowserApprovalStore.getState().resolveApproval(prompt.id, "once");
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    await tick();
    expect(actCalls()).toHaveLength(0);
    expect(mint).not.toHaveBeenCalled();
    // W-04: the human hold is released with the interrupted run — a new run may start.
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    expect(startWorkflowRun(SOURCE, baseCtx()).ok).toBe(true);
  });

  it("cancel during the wait: a later standing grant never acts", async () => {
    const res = startWorkflowRun(SOURCE, baseCtx());
    if (!res.ok) return;
    await tick();
    expect(cancelWorkflowRun(res.runId)).toEqual({ outcome: "cancelled" });
    expect(workflowRunStatus(res.runId)?.status).toBe("cancelled");
    expect(runPrompt(res.runId)).toBeUndefined();
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    await tick();
    await flush();
    expect(actCalls()).toHaveLength(0);
    expect(workflowRunStatus(res.runId)?.status).toBe("cancelled");
  });

  it("a denied prompt pauses the run as denied and withdraws nothing else", async () => {
    const res = startWorkflowRun(SOURCE, baseCtx());
    if (!res.ok) return;
    await tick();
    useBrowserApprovalStore.getState().resolveApproval(runPrompt(res.runId)!.id, "deny");
    await tick();
    await flush();
    expect(workflowRunStatus(res.runId)).toMatchObject({ status: "paused", reasonCode: "denied", pausedAt: "step-1" });
    expect(actCalls()).toHaveLength(0);
  });
});

describe("deadline (W-06 / D1v2)", () => {
  it("the 120 s budget counts running time and pauses the run as deadline", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click", "type"]);
    // Every clock read costs 30 s of "running time": step 1 runs (60 s elapsed at
    // its check), step 2's check sees the budget spent.
    let t = 0;
    const res = startWorkflowRun(TWO_STEP, baseCtx({ now: () => (t += 30_000), deadlineMs: 120_000 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await flush();
    expect(workflowRunStatus(res.runId)).toMatchObject({ status: "paused", reasonCode: "deadline", pausedAt: "step-2" });
    expect(actCalls()).toHaveLength(1);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("a full prompt queue pauses the run as queue-full", async () => {
    useBrowserApprovalStore.setState({
      pending: Array.from({ length: 64 }, (_, i) => ({ id: `flood-${i}`, targetUrl: URL, operation: "click", tabId: "other", generation: 1 })),
    });
    const res = startWorkflowRun(SOURCE, baseCtx());
    if (!res.ok) return;
    await flush();
    expect(workflowRunStatus(res.runId)).toMatchObject({ status: "paused", reasonCode: "queue-full" });
  });
});

describe("completed-write ledger keyed on normalised source + inputs (W-07)", () => {
  it("a byte-different but semantically identical source keeps the ledger: completed writes are skipped and reported", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click", "type"]);
    const first = startWorkflowRun(TWO_STEP, baseCtx());
    if (!first.ok) return;
    await flush();
    expect(workflowRunStatus(first.runId)?.status).toBe("completed");
    invoke.mockClear();
    const edited = `${TWO_STEP.replace(/\n/g, "\r\n")}  \r\n# a trailing comment\r\n`;
    const second = startWorkflowRun(edited, baseCtx());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.firstStep).toBeNull();
    await flush();
    const st = workflowRunStatus(second.runId)!;
    expect(st.status).toBe("completed");
    expect(st.stepResults).toEqual([
      { index: 1, status: "skipped", attempts: 0, reason: "already-completed" },
      { index: 2, status: "skipped", attempts: 0, reason: "already-completed" },
    ]);
    expect(st.completedSteps).toBe(0);
    expect(st.skippedSteps).toBe(2);
    expect(actCalls()).toHaveLength(0);
  });

  it("the same source with DIFFERENT inputs runs every write again", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click", "type"]);
    const first = startWorkflowRun(TWO_STEP, baseCtx({ inputs: { title: "first" } }));
    if (!first.ok) return;
    await flush();
    invoke.mockClear();
    const second = startWorkflowRun(TWO_STEP, baseCtx({ inputs: { title: "second" } }));
    if (!second.ok) return;
    expect(second.firstStep).toBe("step-1");
    await flush();
    expect(workflowRunStatus(second.runId)?.stepResults.map((s) => s.status)).toEqual(["success", "success"]);
    expect(actCalls()).toHaveLength(2);
  });

  it("allowRepeat re-executes ledgered writes", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    const first = startWorkflowRun(SOURCE, baseCtx());
    if (!first.ok) return;
    await flush();
    invoke.mockClear();
    const second = startWorkflowRun(SOURCE, baseCtx({ allowRepeat: true }));
    if (!second.ok) return;
    await flush();
    expect(actCalls()).toHaveLength(1);
  });
});

describe("resume (W-05)", () => {
  const WITH_CONFIRM = ["---", "site: blog", "inputs: [title]", "---", '1. action: type {title} into "Title" (textbox)', "2. confirm: check the preview", '3. action: click "Publish" (button)'].join("\n");

  it("a paused run can be resumed: completed steps and the human's step are skipped, the old run is superseded", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click", "type"]);
    const first = startWorkflowRun(WITH_CONFIRM, baseCtx());
    if (!first.ok) return;
    await flush();
    expect(workflowRunStatus(first.runId)).toMatchObject({ status: "paused", pausedAt: "step-2", reasonCode: "needs-human" });
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
    invoke.mockClear();

    const resumed = startWorkflowRun(WITH_CONFIRM, baseCtx({ resumeRunId: first.runId }));
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.firstStep).toBe("step-3");
    await flush();
    const st = workflowRunStatus(resumed.runId)!;
    expect(st.status).toBe("completed");
    expect(st.resumedFrom).toBe(first.runId);
    expect(st.stepResults).toEqual([
      { index: 1, status: "skipped", attempts: 0, reason: "already-completed" },
      { index: 2, status: "skipped", attempts: 0, reason: "done-by-human" },
      { index: 3, status: "success", attempts: 1 },
    ]);
    expect(actCalls()).toHaveLength(1); // only the Publish click
    expect(workflowRunStatus(first.runId)).toMatchObject({ status: "superseded", reasonCode: "superseded" });
  });

  it("a resume with different inputs still does not re-run the completed write", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click", "type"]);
    const first = startWorkflowRun(WITH_CONFIRM, baseCtx({ inputs: { title: "a" } }));
    if (!first.ok) return;
    await flush();
    invoke.mockClear();
    const resumed = startWorkflowRun(WITH_CONFIRM, baseCtx({ inputs: { title: "b" }, resumeRunId: first.runId }));
    if (!resumed.ok) return;
    await flush();
    expect(actCalls()).toHaveLength(1);
  });

  it("refuses to resume an unknown, running or completed run", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click", "type"]);
    expect(startWorkflowRun(WITH_CONFIRM, baseCtx({ resumeRunId: "nope" }))).toEqual({ ok: false, error: "RUN_NOT_FOUND" });
    const done = startWorkflowRun(TWO_STEP, baseCtx());
    if (!done.ok) return;
    await flush();
    expect(startWorkflowRun(TWO_STEP, baseCtx({ resumeRunId: done.runId }))).toEqual({ ok: false, error: "RESUME_NOT_PAUSED" });
  });
});

describe("cancelWorkflowRun (W-08)", () => {
  it("cancels a live run, withdraws its prompts, and releases the lease", async () => {
    const res = startWorkflowRun(SOURCE, baseCtx());
    if (!res.ok) return;
    await tick();
    expect(runPrompt(res.runId)).toBeDefined();
    expect(cancelWorkflowRun(res.runId)).toEqual({ outcome: "cancelled" });
    expect(workflowRunStatus(res.runId)?.status).toBe("cancelled");
    expect(runPrompt(res.runId)).toBeUndefined();
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("reports an unknown run as not-found", () => {
    expect(cancelWorkflowRun("nope")).toEqual({ outcome: "not-found" });
  });

  it("is a no-op on a terminal run, reporting already-terminal and leaving the status alone", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    const res = startWorkflowRun(SOURCE, baseCtx());
    if (!res.ok) return;
    await flush();
    expect(cancelWorkflowRun(res.runId)).toEqual({ outcome: "already-terminal", status: "completed" });
    expect(workflowRunStatus(res.runId)?.status).toBe("completed");
  });

  it("releases the lease only if THIS run holds it — cancelling an old paused run leaves the live run's lease alone", async () => {
    const goal = ["---", "site: blog", "---", "1. goal: x"].join("\n");
    const paused = startWorkflowRun(goal, baseCtx({ inputs: {} }));
    if (!paused.ok) return;
    await flush();
    expect(workflowRunStatus(paused.runId)?.status).toBe("paused");
    const live = startWorkflowRun(SOURCE, baseCtx());
    if (!live.ok) return;
    await tick();
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai");
    expect(cancelWorkflowRun(paused.runId)).toEqual({ outcome: "cancelled" });
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai"); // untouched
    expect(workflowRunStatus(live.runId)?.status).toBe("running");
    expect(runPrompt(live.runId)).toBeDefined(); // the live run's prompt survives
    cancelWorkflowRun(live.runId);
  });
});
