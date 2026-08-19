// @vitest-environment jsdom
// WI-NB6.2/6.3 — the run orchestrator: validate → acquire lease → run detached
// → status/cancel. The run does not live inside the starting request (Codex
// review: the bridge bounds a request at ~20s).
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/browser/grantSync", () => ({
  mintOneShotConfirmed: vi.fn(() => Promise.resolve(true)),
}));

import { startWorkflowRun, workflowRunStatus, cancelWorkflowRun } from "./workflowRunService";
import { __resetRunRegistry } from "./runRegistry";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserLeaseStore } from "@/services/browser/lease";

const TAB = "tab-1";
const URL = "https://blog.example.com/";

const SOURCE = ["---", "site: blog", "inputs: [title]", "---", '1. action: click "Publish" (button)'].join("\n");

function resolveTab() {
  return { url: URL, generation: 1 };
}

function baseCtx(over = {}) {
  return { tabId: TAB, resolveTab, inputs: { title: "x" }, deadlineMs: 120000, ...over };
}

/** Drain microtasks so the detached run settles. */
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(JSON.stringify({ found: true, clicked: true }));
  __resetRunRegistry();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
  useBrowserLeaseStore.setState({ leases: {}, inflightCancel: {} });
});

describe("startWorkflowRun", () => {
  it("returns a runId immediately and acquires the AI lease", () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const res = startWorkflowRun(SOURCE, baseCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.runId).toMatch(/^wfrun-/);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBe("ai");
    expect(workflowRunStatus(res.runId)?.status).toBe("running");
  });

  it("rejects a malformed source with parse diagnostics and takes no lease", () => {
    const res = startWorkflowRun("no front matter here", baseCtx());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/parse|site/i);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("refuses a missing input", () => {
    const res = startWorkflowRun(SOURCE, baseCtx({ inputs: {} }));
    expect(res.ok).toBe(false);
  });

  it("refuses a second run on a busy tab", () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const first = startWorkflowRun(SOURCE, baseCtx());
    expect(first.ok).toBe(true);
    const second = startWorkflowRun(SOURCE, baseCtx());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/already/i);
  });

  it("enforces the step-count bound", () => {
    const many = ["---", "site: blog", "---", ...Array.from({ length: 30 }, (_, i) => `${i + 1}. action: click "B${i}"`)].join("\n");
    const res = startWorkflowRun(many, baseCtx({ inputs: {} }));
    expect(res.ok).toBe(false);
  });

  it("runs to completion and releases the lease", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const res = startWorkflowRun(SOURCE, baseCtx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await flush();
    expect(workflowRunStatus(res.runId)?.status).toBe("completed");
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("pauses on a goal step and reports where", async () => {
    const src = ["---", "site: blog", "---", "1. goal: find my dashboard"].join("\n");
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const res = startWorkflowRun(src, baseCtx({ inputs: {} }));
    if (!res.ok) return;
    await flush();
    const st = workflowRunStatus(res.runId);
    expect(st?.status).toBe("paused");
    expect(st?.pausedAt).toBe("step-1");
  });
});

describe("cancelWorkflowRun", () => {
  it("cancels a live run, withdraws its prompts, and releases the lease", async () => {
    // A run that will pause awaiting approval (ungranted click, short deadline is
    // irrelevant — we cancel before it resolves).
    const res = startWorkflowRun(SOURCE, baseCtx());
    if (!res.ok) return;
    await flush();
    // The run raised a run-scoped prompt (ungranted click).
    expect(useBrowserApprovalStore.getState().pending.some((p) => p.runId === res.runId)).toBe(true);
    cancelWorkflowRun(res.runId);
    expect(workflowRunStatus(res.runId)?.status).toBe("cancelled");
    expect(useBrowserApprovalStore.getState().pending.some((p) => p.runId === res.runId)).toBe(false);
    expect(useBrowserLeaseStore.getState().currentHolder(TAB)).toBeNull();
  });

  it("is a no-op on an unknown run", () => {
    expect(() => cancelWorkflowRun("nope")).not.toThrow();
  });
});
