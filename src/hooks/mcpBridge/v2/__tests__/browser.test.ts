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

const BLOG = "https://blog.example.com/";

function seedBrowserTab(): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", BLOG, "Blog");
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [] });
});

function lastResponse() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

describe("handleBrowserRead", () => {
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

  it("defaults type text to empty when omitted", async () => {
    const id = seedBrowserTab();
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    invoke.mockResolvedValue(JSON.stringify({ found: false, typed: false }));
    await handleBrowserAct("a5", { tabId: id, operation: "type", role: "textbox", name: "X" });
    expect(invoke).toHaveBeenCalledWith("browser_eval", expect.objectContaining({ script: expect.stringContaining("__vmarkType") }));
    expect(lastResponse()).toMatchObject({ id: "a5", success: true });
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
