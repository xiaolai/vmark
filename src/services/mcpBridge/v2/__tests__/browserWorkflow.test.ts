// @vitest-environment jsdom
// WI-NB6.3 — the workflow_run/status/cancel MCP handlers.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
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
import { __resetRunRegistry } from "@/services/workflow/runRegistry";

const URL = "https://blog.example.com/";
const SOURCE = ["---", "site: blog", "---", '1. action: click "Publish" (button)'].join("\n");

function seed(mode: "ai-sandbox" | "human" = "ai-sandbox"): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
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

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(JSON.stringify({ found: true, clicked: true }));
  vi.mocked(respond).mockClear();
  __resetRunRegistry();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
  useBrowserLeaseStore.setState({ leases: {}, inflightCancel: {} });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("workflow_run", () => {
  it("starts a run and returns a runId", async () => {
    const id = seed();
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE });
    const res = lastResponse();
    expect(res.success).toBe(true);
    expect(String(res.data?.runId)).toMatch(/^wfrun-/);
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

  it("rejects malformed inputs", async () => {
    const id = seed();
    await handleBrowserWorkflowRun("r-in", { tabId: id, source: SOURCE, inputs: { x: 5 } });
    expect(lastResponse().success).toBe(false);
  });

  it("fails closed when the browser is disabled", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    seed();
    await handleBrowserWorkflowRun("r-off", { source: SOURCE });
    expect(lastResponse()).toMatchObject({ success: false, error: "BROWSER_DISABLED" });
  });
});

describe("workflow_status", () => {
  it("reports a run's state", async () => {
    const id = seed();
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE });
    const runId = String(lastResponse().data?.runId);
    await flush();
    await handleBrowserWorkflowStatus("s1", { runId });
    const st = lastResponse();
    expect(st.success).toBe(true);
    expect(st.data?.status).toBe("completed");
    expect(st.data?.stepCount).toBe(1);
  });

  it("errors on an unknown runId", async () => {
    seed();
    await handleBrowserWorkflowStatus("s-x", { runId: "nope" });
    expect(lastResponse().success).toBe(false);
  });
});

describe("workflow_cancel", () => {
  it("cancels a live run and is never approval-gated", async () => {
    const id = seed();
    // ungranted click → the run pauses awaiting approval; cancel it
    await handleBrowserWorkflowRun("r1", { tabId: id, source: SOURCE });
    const runId = String(lastResponse().data?.runId);
    await flush();
    await handleBrowserWorkflowCancel("c1", { runId });
    expect(lastResponse()).toMatchObject({ success: true, data: { status: "cancelled" } });
  });
});
