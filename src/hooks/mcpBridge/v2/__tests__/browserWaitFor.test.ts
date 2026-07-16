// WI-P3.1 — vmark.browser.wait_for: a bounded poll for a page condition
// (a ref, a role+name, or visible text). Read-class; distinguishes matched vs
// timeout in the response.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { respond } from "../../utils";
import { handleBrowserWaitFor } from "../browserWaitFor";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";

const SITE = "https://x.example.com/";
function seed(mode: "ai-sandbox" | "human" = "ai-sandbox"): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", SITE, "X", mode);
}
function lastResponse() {
  const c = vi.mocked(respond).mock.calls;
  return c[c.length - 1][0];
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("handleBrowserWaitFor", () => {
  it("resolves matched:true as soon as the condition holds, via a read-class eval", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ matched: true, ref: "e2" }));
    await handleBrowserWaitFor("w1", { tabId: id, role: "heading", name: "Done", timeoutMs: 5000 });
    expect(invoke).toHaveBeenCalledWith("browser_eval", expect.objectContaining({ operation: "read" }));
    expect(lastResponse()).toMatchObject({ id: "w1", success: true, data: { matched: true, ref: "e2" } });
  });

  it("polls until the condition becomes true", async () => {
    const id = seed();
    invoke
      .mockResolvedValueOnce(JSON.stringify({ matched: false }))
      .mockResolvedValueOnce(JSON.stringify({ matched: true }));
    await handleBrowserWaitFor("w2", { tabId: id, text: "Loaded", timeoutMs: 5000 });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(lastResponse()).toMatchObject({ data: { matched: true } });
  });

  it("returns matched:false on timeout (not an error)", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ matched: false }));
    await handleBrowserWaitFor("w3", { tabId: id, text: "Never", timeoutMs: 1 });
    expect(lastResponse()).toMatchObject({ id: "w3", success: true, data: { matched: false } });
  });

  it("fails closed when the browser is disabled", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    seed();
    await handleBrowserWaitFor("w-off", { text: "x" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false, error: "BROWSER_DISABLED" });
  });

  it("requires exactly one condition", async () => {
    const id = seed();
    await handleBrowserWaitFor("w-none", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });

    await handleBrowserWaitFor("w-two", { tabId: id, text: "a", role: "button" });
    expect(lastResponse()).toMatchObject({ success: false });
  });

  it("requires an attachment on a human tab before polling", async () => {
    const id = seed("human");
    await handleBrowserWaitFor("w-h", { tabId: id, text: "x", timeoutMs: 100 });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ error: "ATTACHMENT_REQUIRED" });
  });
});
