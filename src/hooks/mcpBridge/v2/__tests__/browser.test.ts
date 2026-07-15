// WI-2.5 — vmark.browser MCP handlers: read (snapshot) + act (approval-gated)
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { respond } from "../../utils";
import { handleBrowserRead, handleBrowserAct } from "../browser";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";

const BLOG = "https://blog.example.com/";

function seedBrowserTab(): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", BLOG, "Blog", "ai-sandbox");
}

function seedHumanBrowserTab(): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", BLOG, "Blog", "human");
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

function lastResponse() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

describe("handleBrowserRead", () => {
  it("requests explicit attachment before reading a human browser tab", async () => {
    const id = seedHumanBrowserTab();
    await handleBrowserRead("attach-1", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ error: "ATTACHMENT_REQUIRED" });
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({
      operation: "attach",
      tabId: id,
      generation: 0,
    });
  });

  it("evals the ARIA snapshot script and responds with the parsed snapshot + url", async () => {
    const id = seedBrowserTab();
    invoke.mockResolvedValue(JSON.stringify([{ role: "button", name: "Publish" }]));
    await handleBrowserRead("r1", { tabId: id });
    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ tabId: id, script: expect.stringContaining("__vmarkSnapshot") }),
    );
    const res = lastResponse();
    expect(res).toMatchObject({ id: "r1", success: true });
    expect((res.data as { url: string }).url).toBe(BLOG);
    expect((res.data as { snapshot: unknown[] }).snapshot).toEqual([{ role: "button", name: "Publish" }]);
  });

  it("resolves the active browser tab when no tabId is given", async () => {
    seedBrowserTab(); // createBrowserTab also makes it the active tab in "main"
    invoke.mockResolvedValue(JSON.stringify([]));
    await handleBrowserRead("r3", {});
    expect(invoke).toHaveBeenCalledWith("browser_eval", expect.objectContaining({ script: expect.any(String) }));
    expect(lastResponse()).toMatchObject({ id: "r3", success: true });
  });

  it("errors when the tab is not a browser tab", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
    const docId = useTabStore.getState().createTab("main", "/a.md");
    await handleBrowserRead("r2", { tabId: docId });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "r2", success: false });
  });
});

describe("handleBrowserAct", () => {
  it("performs an allowed action via a generated click script", async () => {
    const id = seedBrowserTab();
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true }));
    await handleBrowserAct("a1", { tabId: id, operation: "click", role: "button", name: "Publish" });
    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ tabId: id, script: expect.stringContaining("__vmarkClick") }),
    );
    expect(lastResponse()).toMatchObject({ id: "a1", success: true });
  });

  it("consumes a one-shot human attachment after the driver accepts an action", async () => {
    const id = seedHumanBrowserTab();
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["click"] }],
      pending: [],
      oneShots: [],
      attachments: [{ tabId: id, generation: 0, once: true }],
    });
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true }));

    await handleBrowserAct("human-act", {
      tabId: id,
      operation: "click",
      role: "button",
      name: "Publish",
    });

    expect(lastResponse()).toMatchObject({ id: "human-act", success: true });
    expect(useBrowserApprovalStore.getState().attachments).toEqual([]);
  });

  it("requests approval (and does not act) when not granted", async () => {
    const id = seedBrowserTab();
    await handleBrowserAct("a2", { tabId: id, operation: "click", role: "button", name: "Publish" });
    expect(invoke).not.toHaveBeenCalled();
    const res = lastResponse();
    expect(res.success).toBe(false);
    expect((res.data as { needsApproval: boolean }).needsApproval).toBe(true);
    // A pending approval was queued under the request id.
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);
    expect(useBrowserApprovalStore.getState().pending[0].id).toBe("a2");
  });

  it("denies upload outright (never acts)", async () => {
    const id = seedBrowserTab();
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["upload"]);
    await handleBrowserAct("a3", { tabId: id, operation: "upload", role: "button", name: "Choose file" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "a3", success: false });
  });

  it("rejects a type without a string text instead of clearing the field", async () => {
    // Omitting `text` used to default to "" — a silent, destructive field clear.
    // A `type` with no text is malformed input, not an intentional clear.
    const id = seedBrowserTab();
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    invoke.mockResolvedValue(JSON.stringify({ found: false, typed: false }));
    await handleBrowserAct("a5", { tabId: id, operation: "type", role: "textbox", name: "X" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "a5", success: false });
  });

  it("accepts an explicit empty text as an intentional clear", async () => {
    const id = seedBrowserTab();
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, typed: true }));
    await handleBrowserAct("a5b", { tabId: id, operation: "type", role: "textbox", name: "X", text: "" });
    expect(invoke).toHaveBeenCalledWith("browser_eval", expect.objectContaining({ script: expect.stringContaining("__vmarkType") }));
    expect(lastResponse()).toMatchObject({ id: "a5b", success: true });
  });

  it("uses a type script for the type operation", async () => {
    const id = seedBrowserTab();
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, typed: true }));
    await handleBrowserAct("a4", {
      tabId: id,
      operation: "type",
      role: "textbox",
      name: "Title",
      text: "Hello",
    });
    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ script: expect.stringContaining("__vmarkType") }),
    );
    expect(lastResponse()).toMatchObject({ id: "a4", success: true });
  });
});

// WI-2.1 — the driver gate: every eval must be stamped with the operation and the
// navigation generation, so the Rust origin guard (browser/origin_guard.rs) can
// enforce R4/R5/R7a instead of trusting this layer's advisory check.
describe("driver-gate stamping (WI-2.1)", () => {
  it("read stamps operation=read and the tab's committed generation", async () => {
    const id = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(id, { generation: 7 });
    invoke.mockResolvedValue(JSON.stringify([]));

    await handleBrowserRead("r-gate", { tabId: id });

    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ operation: "read", generation: 7 }),
    );
  });

  it("act stamps the requested operation and generation", async () => {
    const id = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(id, { generation: 3 });
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["click"] }],
      pending: [],
    });
    invoke.mockResolvedValue("{}");

    await handleBrowserAct("a-gate", { tabId: id, operation: "click", role: "button", name: "Publish" });

    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ operation: "click", generation: 3 }),
    );
  });

  it("stamps generation 0 when no navigation has committed yet — the driver refuses it", async () => {
    // Fail-closed: a tab that never committed a navigation has no committed origin
    // in the registry, so the driver rejects the eval. The frontend must not invent
    // a plausible-looking generation to paper over that.
    const id = seedBrowserTab();
    invoke.mockResolvedValue(JSON.stringify([]));

    await handleBrowserRead("r-nogen", { tabId: id });

    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ generation: 0 }),
    );
  });

  it("surfaces a driver refusal to the caller instead of swallowing it", async () => {
    const id = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(id, { generation: 2 });
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["click"] }],
      pending: [],
    });
    // The driver is the authority: even with a local grant, it can refuse (e.g. the
    // page navigated). That refusal must reach the AI as a failure.
    invoke.mockRejectedValue(
      "stale command: tab navigated or closed since this operation was authorized",
    );

    await handleBrowserAct("a-stale", { tabId: id, operation: "click", role: "button", name: "Publish" });

    const res = lastResponse();
    expect(res).toMatchObject({ id: "a-stale", success: false });
    expect(String(res.error)).toContain("stale command");
  });
});

// "Allow once" end-to-end: the AI's retry arrives under a NEW request id, so the
// handler must consume the one-shot minted for (origin, operation) — otherwise
// "Allow once" authorizes nothing and the AI re-prompts forever.
describe("allow-once consumption (WI-2.6)", () => {
  it("a one-shot authorizes the retry, and only the retry", async () => {
    const tabId = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(tabId, { generation: 1 });
    // A truthy click result: `act` now reports success only when the click landed.
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true }));

    // 1) First attempt: no grant → refused, approval queued.
    await handleBrowserAct("act-1", { tabId, operation: "click", role: "button", name: "Publish" });
    expect(lastResponse()).toMatchObject({ success: false });
    expect(invoke).not.toHaveBeenCalled();

    // 2) The human clicks "Allow once".
    useBrowserApprovalStore.getState().resolveApproval("act-1", "once");

    // 3) The AI retries under a NEW id — this must go through.
    await handleBrowserAct("act-2", { tabId, operation: "click", role: "button", name: "Publish" });
    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ operation: "click" }),
    );
    expect(lastResponse()).toMatchObject({ id: "act-2", success: true });

    // 4) A second retry is NOT authorized — the one-shot is spent.
    invoke.mockClear();
    await handleBrowserAct("act-3", { tabId, operation: "click", role: "button", name: "Publish" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "act-3", success: false });
  });

  it("a one-shot for click does not authorize a type", async () => {
    const tabId = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(tabId, { generation: 1 });
    invoke.mockResolvedValue("{}");

    await handleBrowserAct("t-1", { tabId, operation: "click", role: "button", name: "Publish" });
    useBrowserApprovalStore.getState().resolveApproval("t-1", "once");

    await handleBrowserAct("t-2", { tabId, operation: "type", role: "textbox", name: "Title", text: "x" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "t-2", success: false });
  });
});

// `act` maps every non-"type" operation to a CLICK script. A "read" (or any other
// known-but-not-actionable operation) reaching act would therefore execute a
// mutating click under the authority of a read grant. act accepts click|type only.
describe("act operation vocabulary", () => {
  it("refuses an operation that is not click or type", async () => {
    const tabId = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(tabId, { generation: 1 });
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["read"] }],
      pending: [],
      oneShots: [],
    });
    invoke.mockResolvedValue("{}");

    await handleBrowserAct("op-read", { tabId, operation: "read", role: "button", name: "Publish" });

    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "op-read", success: false });
  });

  it("refuses an act with a blank role or name instead of targeting the first element", async () => {
    const tabId = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(tabId, { generation: 1 });
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["click"] }],
      pending: [],
      oneShots: [],
    });
    invoke.mockResolvedValue("{}");

    await handleBrowserAct("blank", { tabId, operation: "click", role: "", name: "" });

    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "blank", success: false });
  });

  it("refuses a whitespace-only role or name (a padded blank is still blank)", async () => {
    const tabId = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(tabId, { generation: 1 });
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["click"] }],
      pending: [],
      oneShots: [],
    });
    invoke.mockResolvedValue("{}");

    await handleBrowserAct("ws", { tabId, operation: "click", role: "  ", name: "\t" });

    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "ws", success: false });
  });
});

// A completed eval is not a completed action: the script reports `found:false`,
// `clicked:false`, or `typed:false` when the target was missing/disabled/readonly.
// Reporting those as `success:true` tells the AI a no-op mutation happened.
describe("act reports the action outcome, not merely eval completion", () => {
  it("returns failure when a click found nothing", async () => {
    const tabId = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(tabId, { generation: 1 });
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["click"] }],
      pending: [],
      oneShots: [],
    });
    invoke.mockResolvedValue(JSON.stringify({ found: false, clicked: false }));

    await handleBrowserAct("miss", { tabId, operation: "click", role: "button", name: "Nope" });

    const res = lastResponse();
    expect(res).toMatchObject({ id: "miss", success: false });
    // The detail rides along so the AI can see WHY it failed.
    expect(res.data).toMatchObject({ result: { found: false, clicked: false } });
  });

  it("returns failure when a type was refused (readonly)", async () => {
    const tabId = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(tabId, { generation: 1 });
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["type"] }],
      pending: [],
      oneShots: [],
    });
    invoke.mockResolvedValue(JSON.stringify({ found: true, typed: false, reason: "readonly" }));

    await handleBrowserAct("ro", { tabId, operation: "type", role: "textbox", name: "Title", text: "x" });

    expect(lastResponse()).toMatchObject({ id: "ro", success: false });
  });

  it("still reports success when the click landed", async () => {
    const tabId = seedBrowserTab();
    useTabStore.getState().updateBrowserTab(tabId, { generation: 1 });
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://blog.example.com", operations: ["click"] }],
      pending: [],
      oneShots: [],
    });
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true }));

    await handleBrowserAct("hit", { tabId, operation: "click", role: "button", name: "Publish" });

    expect(lastResponse()).toMatchObject({ id: "hit", success: true });
  });
});

// An explicitly-supplied tabId that is empty/whitespace/non-string must NOT
// silently fall back to the active tab — that could act on an unintended page.
describe("tabId argument validation", () => {
  it("rejects an empty-string tabId instead of falling back to the active tab", async () => {
    seedBrowserTab();
    await handleBrowserRead("empty-tab", { tabId: "" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "empty-tab", success: false });
  });

  it("rejects a whitespace-only tabId on act", async () => {
    seedBrowserTab();
    await handleBrowserAct("ws-tab", { tabId: "   ", operation: "click", role: "button", name: "Publish" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "ws-tab", success: false });
  });

  it("rejects a non-string tabId", async () => {
    seedBrowserTab();
    await handleBrowserRead("num-tab", { tabId: 42 });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "num-tab", success: false });
  });

  it("still falls back to the active tab when tabId is absent", async () => {
    seedBrowserTab();
    invoke.mockResolvedValue(JSON.stringify([]));
    await handleBrowserRead("no-tab", {});
    expect(invoke).toHaveBeenCalledWith("browser_eval", expect.objectContaining({ operation: "read" }));
    expect(lastResponse()).toMatchObject({ id: "no-tab", success: true });
  });
});
