// WI-P5.1/P5.2/P5.3 — scripted power tools: query (read), style (act), and
// execute_js (eval — per-call approval only, result flagged untrusted).
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { respond } from "../../utils";
import { handleBrowserQuery, handleBrowserStyle, handleBrowserExecuteJs } from "../browserPower";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";

const BLOG = "https://blog.example.com/";
function seed(): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  const id = useTabStore.getState().createBrowserTab("main", BLOG, "Blog", "ai-sandbox");
  useTabStore.getState().updateBrowserTab(id, { generation: 1 });
  return id;
}
function grant(...ops: string[]) {
  useBrowserApprovalStore.getState().grant("https://blog.example.com", ops);
}
function lastResponse() {
  const c = vi.mocked(respond).mock.calls;
  return c[c.length - 1][0];
}
function evalCall() {
  return invoke.mock.calls.find((c) => c[0] === "browser_eval")?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("handleBrowserQuery (read-class)", () => {
  it("queries by selector and returns the structured result", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ count: 1, elements: [{ ref: "e1", tag: "button" }] }));
    await handleBrowserQuery("q1", { tabId: id, selector: "button" });
    expect(evalCall()).toMatchObject({ operation: "read", generation: 1 });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkQueryDom"));
    expect(lastResponse()).toMatchObject({ id: "q1", success: true, data: { count: 1 } });
  });

  it("refuses a missing selector", async () => {
    const id = seed();
    await handleBrowserQuery("q2", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });
});

describe("handleBrowserStyle (act-class, op=style)", () => {
  it("applies a style on a granted origin", async () => {
    const id = seed();
    grant("style");
    invoke.mockResolvedValue(JSON.stringify({ found: true, styled: true }));
    await handleBrowserStyle("s1", { tabId: id, selector: ".overlay", set: { display: "none" } });
    expect(evalCall()).toMatchObject({ operation: "style", generation: 1 });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkStyleOp"));
    expect(lastResponse()).toMatchObject({ success: true, data: { result: { styled: true } } });
  });

  it("requests approval for style on an un-granted origin", async () => {
    const id = seed();
    await handleBrowserStyle("s2", { tabId: id, selector: ".x", set: { color: "red" } });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "style" });
  });

  it("refuses when neither a target nor an operation is given", async () => {
    const id = seed();
    grant("style");
    await handleBrowserStyle("s3", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });
});

describe("handleBrowserExecuteJs (eval — per-call approval only)", () => {
  it("requires a fresh per-call approval; a grant never authorizes it", async () => {
    const id = seed();
    grant("eval"); // stripped from the grant — must not help
    await handleBrowserExecuteJs("x1", { tabId: id, script: "return document.title;" });
    expect(invoke).not.toHaveBeenCalled();
    const res = lastResponse();
    expect((res.data as { needsApproval?: boolean }).needsApproval).toBe(true);
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "eval" });
  });

  it("runs the caller script after an Allow-once and flags the result untrusted", async () => {
    const id = seed();
    // First call raises approval; user clicks Allow once; retry runs.
    await handleBrowserExecuteJs("x-a", { tabId: id, script: "return 2+2;" });
    useBrowserApprovalStore.getState().resolveApproval("x-a", "once");
    invoke.mockResolvedValue(JSON.stringify(4));
    await handleBrowserExecuteJs("x-b", { tabId: id, script: "return 2+2;" });
    expect(evalCall()).toMatchObject({ operation: "eval", generation: 1 });
    expect(evalCall()?.script).toBe("return 2+2;");
    const res = lastResponse();
    expect(res).toMatchObject({ id: "x-b", success: true });
    expect((res.data as { untrusted?: boolean }).untrusted).toBe(true);
  });

  it("refuses a missing script", async () => {
    const id = seed();
    await handleBrowserExecuteJs("x2", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });
});
