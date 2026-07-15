// WI-P1.2 — vmark.browser.screenshot handler: read-class visual capture.
// Mirrors handleBrowserRead's gate/attachment/redaction contract, but returns
// {url, image} where image is a base64 JPEG produced by the native command.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { respond } from "../../utils";
import { handleBrowserScreenshot } from "../browserScreenshot";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";

const SITE = "https://shop.example.com/cart";
const IMG = "BASE64JPEGDATA";

function seedTab(mode: "ai-sandbox" | "ai-shared" | "human" = "ai-sandbox"): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", SITE, "Shop", mode);
}

function lastResponse() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("handleBrowserScreenshot", () => {
  it("fails closed when the browser feature is disabled", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    seedTab();
    await handleBrowserScreenshot("s-off", {});
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "s-off", success: false, error: "BROWSER_DISABLED" });
  });

  it("captures an AI tab and returns {url, image} with the base64 JPEG", async () => {
    const id = seedTab();
    invoke.mockResolvedValue(IMG);
    await handleBrowserScreenshot("s1", { tabId: id });
    expect(invoke).toHaveBeenCalledWith(
      "browser_screenshot",
      expect.objectContaining({ tabId: id, generation: 0 }),
    );
    const res = lastResponse();
    expect(res).toMatchObject({ id: "s1", success: true });
    expect((res.data as { url: string; image: string })).toEqual({ url: SITE, image: IMG });
  });

  it("stamps the tab's committed generation on the native command", async () => {
    const id = seedTab();
    useTabStore.getState().updateBrowserTab(id, { generation: 4 });
    invoke.mockResolvedValue(IMG);
    await handleBrowserScreenshot("s-gen", { tabId: id });
    expect(invoke).toHaveBeenCalledWith(
      "browser_screenshot",
      expect.objectContaining({ generation: 4 }),
    );
  });

  it("resolves the active browser tab when no tabId is given", async () => {
    seedTab();
    invoke.mockResolvedValue(IMG);
    await handleBrowserScreenshot("s2", {});
    expect(invoke).toHaveBeenCalledWith("browser_screenshot", expect.objectContaining({ generation: 0 }));
    expect(lastResponse()).toMatchObject({ id: "s2", success: true });
  });

  it("requires explicit attachment before capturing a human browser tab", async () => {
    const id = seedTab("human");
    await handleBrowserScreenshot("s-attach", { tabId: id });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ error: "ATTACHMENT_REQUIRED" });
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({
      operation: "attach",
      tabId: id,
      generation: 0,
    });
  });

  it("captures a human tab once attached and then consumes the attachment", async () => {
    const id = seedTab("human");
    useBrowserApprovalStore.setState({
      grants: [],
      pending: [],
      oneShots: [],
      attachments: [{ tabId: id, generation: 0, once: true }],
    });
    invoke.mockResolvedValue(IMG);
    await handleBrowserScreenshot("s-human", { tabId: id });
    expect(lastResponse()).toMatchObject({ id: "s-human", success: true });
    expect(useBrowserApprovalStore.getState().attachments).toEqual([]);
  });

  it("rejects an empty-string tabId instead of falling back to the active tab", async () => {
    seedTab();
    await handleBrowserScreenshot("s-empty", { tabId: "" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "s-empty", success: false });
  });

  it("errors when the tab is not a browser tab", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
    const docId = useTabStore.getState().createTab("main", "/a.md");
    await handleBrowserScreenshot("s-doc", { tabId: docId });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "s-doc", success: false });
  });

  it("surfaces a driver refusal (stale generation) as a failure", async () => {
    const id = seedTab();
    useTabStore.getState().updateBrowserTab(id, { generation: 2 });
    invoke.mockRejectedValue("stale command: tab navigated or closed since this operation was authorized");
    await handleBrowserScreenshot("s-stale", { tabId: id });
    const res = lastResponse();
    expect(res).toMatchObject({ id: "s-stale", success: false });
    expect(String(res.error)).toContain("stale command");
  });
});
