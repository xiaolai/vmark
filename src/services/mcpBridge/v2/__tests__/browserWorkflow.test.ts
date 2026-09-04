// @vitest-environment jsdom
// WI-NB6.3 — the workflow_run/status/cancel MCP handlers.
// Audit 2026-09-03 W-02/W-05/W-08/W-09: the run response carries firstStep, the
// status response the D1v2 contract (pendingApproval, skippedSteps, stepResults,
// resumedFrom), `resumeRunId` is honoured, cancel distinguishes RUN_NOT_FOUND
// and already-terminal, and a navigate step's loaded page reaches the tab store.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/browser/grantSync", () => ({
  startGrantSync: () => () => {},
  mintOneShotConfirmed: vi.fn(() => Promise.resolve(true)),
}));

import { respond } from "@/services/mcpBridge/utils";
import {
  handleBrowserWorkflowRun,
  handleBrowserWorkflowStatus,
  handleBrowserWorkflowCancel,
} from "@/services/mcpBridge/v2/browserWorkflow";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserLeaseStore } from "@/services/browser/lease";
import { useSettingsStore } from "@/stores/settingsStore";
import { browserEventBroker } from "@/services/browser/browserEventBroker";
import { __resetRunRegistry } from "@/services/workflow/runRegistry";

const URL = "https://blog.example.com/";
const ORIGIN = "https://blog.example.com";
const SOURCE = ["---", "site: blog", "---", '1. action: click "Publish" (button)'].join("\n");
const WITH_CONFIRM = ["---", "site: blog", "---", "1. confirm: check the preview", '2. action: click "Publish" (button)'].join("\n");

function seed(mode: "ai-sandbox" | "human" = "ai-sandbox"): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  const id = useTabStore.getState().createBrowserTab("main", URL, "Blog", mode);
  useTabStore.getState().updateBrowserTab(id, { generation: 1 });
  return id;
}
function lastResponse() {
  const c = vi.mocked(respond).mock.calls;
  return c[c.length - 1][0] as { success: boolean; error?: string; data?: Record<string, unknown> };
}
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(JSON.stringify({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
  vi.mocked(respond).mockClear();
  __resetRunRegistry();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
  useBrowserLeaseStore.setState({ leases: {}, inflightCancel: {} });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("workflow_run", () => {
  it("starts a run and returns a runId, the step count and the first step", async () => {
    const id = seed();
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE });
    const res = lastResponse();
    expect(res.success).toBe(true);
    expect(String(res.data?.runId)).toMatch(/^wfrun-/);
    expect(res.data).toMatchObject({ steps: 1, firstStep: "step-1", status: "running" });
  });

  it("refuses a human tab", async () => {
    const id = seed("human");
    await handleBrowserWorkflowRun("r-h", { tabId: id, source: SOURCE });
    expect(lastResponse()).toMatchObject({ success: false, error: "TAB_NOT_AI_OWNED" });
  });

  it("rejects a missing source", async () => {
    seed();
    await handleBrowserWorkflowRun("r-none", {});
    expect(lastResponse().success).toBe(false);
  });

  it("rejects malformed inputs, and undeclared inputs — including prototype-shaped keys (W-09)", async () => {
    const id = seed();
    await handleBrowserWorkflowRun("r-in", { tabId: id, source: SOURCE, inputs: { x: 5 } });
    expect(lastResponse().success).toBe(false);
    await handleBrowserWorkflowRun("r-in2", { tabId: id, source: SOURCE, inputs: JSON.parse('{"constructor":"x"}') });
    expect(lastResponse()).toMatchObject({ success: false, error: 'undeclared input "constructor"' });
    await handleBrowserWorkflowRun("r-in3", { tabId: id, source: SOURCE, inputs: JSON.parse('{"__proto__":"x"}') });
    expect(lastResponse()).toMatchObject({ success: false, error: 'undeclared input "__proto__"' });
  });

  it("fails closed when the browser is disabled", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    seed();
    await handleBrowserWorkflowRun("r-off", { source: SOURCE });
    expect(lastResponse()).toMatchObject({ success: false, error: "BROWSER_DISABLED" });
  });

  it("honours resumeRunId: a paused run is continued past the human's step and superseded (W-05)", async () => {
    const id = seed();
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    await handleBrowserWorkflowRun("r1", { tabId: id, source: WITH_CONFIRM });
    const first = String(lastResponse().data?.runId);
    await flush();
    await handleBrowserWorkflowStatus("s1", { runId: first });
    expect(lastResponse().data).toMatchObject({ status: "paused", pausedAt: "step-1" });

    await handleBrowserWorkflowRun("r2", { tabId: id, source: WITH_CONFIRM, resumeRunId: first });
    const res = lastResponse();
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ firstStep: "step-2" });
    await flush();
    await handleBrowserWorkflowStatus("s2", { runId: String(res.data?.runId) });
    expect(lastResponse().data).toMatchObject({ status: "completed", resumedFrom: first, skippedSteps: 1, completedSteps: 1 });
    await handleBrowserWorkflowStatus("s3", { runId: first });
    expect(lastResponse().data).toMatchObject({ status: "superseded" });
  });

  it("reports an unknown resumeRunId as RUN_NOT_FOUND", async () => {
    const id = seed();
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE, resumeRunId: "nope" });
    expect(lastResponse()).toMatchObject({ success: false, error: "RUN_NOT_FOUND" });
  });

  it("a `navigate to` step awaits the ticket and the tab store learns the new page (W-02)", async () => {
    const id = seed();
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_ai_navigate" ? Promise.resolve({ tabId: id, navigationId: "nav-1" }) : Promise.resolve(JSON.stringify({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 })),
    );
    const src = ["---", "site: blog", "---", "1. action: navigate to https://blog.example.com/new"].join("\n");
    await handleBrowserWorkflowRun("r1", { tabId: id, source: src });
    const runId = String(lastResponse().data?.runId);
    await tick();
    await handleBrowserWorkflowStatus("s0", { runId });
    expect(lastResponse().data?.status).toBe("running"); // still awaiting the navigation
    browserEventBroker.publish({ kind: "loaded", tabId: id, navigationId: "nav-1", generation: 7, url: "https://blog.example.com/new", title: "New" });
    await tick();
    await handleBrowserWorkflowStatus("s1", { runId });
    expect(lastResponse().data).toMatchObject({ status: "completed", url: "https://blog.example.com/new" });
    expect(useTabStore.getState().findTabById(id)).toMatchObject({ generation: 7, url: "https://blog.example.com/new" });
  });
});

describe("workflow_status", () => {
  it("reports the D1v2 contract for a completed run", async () => {
    const id = seed();
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE });
    const runId = String(lastResponse().data?.runId);
    await flush();
    await handleBrowserWorkflowStatus("s1", { runId });
    const st = lastResponse();
    expect(st.success).toBe(true);
    expect(st.data).toMatchObject({
      runId,
      status: "completed",
      stepCount: 1,
      firstStep: "step-1",
      completedSteps: 1,
      skippedSteps: 0,
      stepResults: [{ index: 1, status: "success", attempts: 1 }],
      url: URL,
    });
    expect("pendingApproval" in (st.data ?? {})).toBe(false);
  });

  it("exposes the open prompt as pendingApproval while the run waits", async () => {
    const id = seed();
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE });
    const runId = String(lastResponse().data?.runId);
    await tick();
    await handleBrowserWorkflowStatus("s1", { runId });
    expect(lastResponse().data).toMatchObject({
      status: "running",
      pendingApproval: { operation: "click", url: ORIGIN, target: { role: "button", name: "Publish" } },
    });
    await handleBrowserWorkflowCancel("c", { runId });
  });

  it("errors on an unknown runId", async () => {
    seed();
    await handleBrowserWorkflowStatus("s-x", { runId: "nope" });
    expect(lastResponse()).toMatchObject({ success: false, error: "RUN_NOT_FOUND" });
  });
});

describe("workflow_cancel (W-08)", () => {
  it("cancels a live run and is never approval-gated", async () => {
    const id = seed();
    // ungranted click → the run waits for approval; cancel it
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE });
    const runId = String(lastResponse().data?.runId);
    await tick();
    await handleBrowserWorkflowCancel("c1", { runId });
    expect(lastResponse()).toMatchObject({ success: true, data: { runId, status: "cancelled", result: "cancelled" } });
  });

  it("reports an unknown runId as RUN_NOT_FOUND instead of a phantom cancel", async () => {
    seed();
    await handleBrowserWorkflowCancel("c-x", { runId: "nope" });
    expect(lastResponse()).toMatchObject({ success: false, error: "RUN_NOT_FOUND" });
  });

  it("a terminal run reports already-terminal and keeps its status", async () => {
    const id = seed();
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE });
    const runId = String(lastResponse().data?.runId);
    await flush();
    await handleBrowserWorkflowCancel("c1", { runId });
    expect(lastResponse()).toMatchObject({ success: true, data: { runId, status: "completed", result: "already-terminal" } });
  });
});
