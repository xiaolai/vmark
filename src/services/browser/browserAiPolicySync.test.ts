// @vitest-environment node
// WI-N3.1 / WI-N4.4 — policy synchronization is fail-closed and tears down
// browser state when access or the data-store posture changes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  warn: vi.fn(),
}));

// The real event broker runs; its native boundary is Tauri's `listen`.
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => mocks.listen(...args) }));
// The hub listens on its own webview (window-scoped); route that to the same fake.
vi.mock("@tauri-apps/api/webviewWindow", async () => {
  const events = await import("@tauri-apps/api/event");
  return { getCurrentWebviewWindow: () => ({ listen: events.listen }) };
});
vi.mock("@/utils/debug", () => ({ browserWarn: (...args: unknown[]) => mocks.warn(...args) }));

import { startBrowserAiPolicySync } from "./browserAiPolicySync";
import { browserEventBroker, type BrowserWaitResult } from "./browserEventBroker";
import { BROWSER_NATIVE_EVENTS } from "./browserNativeEventDecoder";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";

const URL = "https://example.com/";
/** A broker ticket on a tab no store knows about: only `cancelPending` settles it. */
const ORPHAN_TAB = "orphan-tab";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Register a pending navigation waiter on the real broker and track its result. */
function pendingWaiter(): { settled: () => BrowserWaitResult | undefined } {
  browserEventBroker.publish({ kind: "navigated", tabId: ORPHAN_TAB, navigationId: "nav-1", generation: 1, url: URL });
  let result: BrowserWaitResult | undefined;
  void browserEventBroker.wait(ORPHAN_TAB, "nav-1", 60_000).then((r) => {
    result = r;
  });
  return { settled: () => result };
}

function reset() {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", false);
  useSettingsStore.getState().updateBrowserSetting("aiSession", "sandbox");
  useSettingsStore.getState().updateBrowserSetting("aiAllowLoopback", false);
  browserEventBroker.cancelPending();
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.unlisten.mockReset();
  mocks.listen.mockReset().mockResolvedValue(mocks.unlisten);
  mocks.warn.mockReset();
}

beforeEach(reset);

describe("startBrowserAiPolicySync", () => {
  it("pushes the initial policy and starts the event broker", async () => {
    const cleanup = startBrowserAiPolicySync();

    expect(mocks.invoke).toHaveBeenCalledWith("browser_ai_policy", {
      enabled: false,
      session: "sandbox",
      allowLoopback: false,
    });
    // The broker subscribed: every native browser event has a live listener.
    const listened = mocks.listen.mock.calls.map((call) => call[0]);
    expect(listened).toEqual([...BROWSER_NATIVE_EVENTS]);
    await flush();
    expect(mocks.unlisten).not.toHaveBeenCalled();

    cleanup();
    await flush();
    expect(mocks.unlisten).toHaveBeenCalledTimes(BROWSER_NATIVE_EVENTS.length);
  });

  it("destroys browser tabs and clears ephemeral approvals when disabled", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    const tabId = useTabStore.getState().createBrowserTab("main", URL, "Example", "ai-sandbox");
    useBrowserApprovalStore.getState().requestApproval("pending", URL, "read", undefined, tabId, 0);
    const cleanup = startBrowserAiPolicySync();
    const waiter = pendingWaiter();

    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    await flush();

    expect(mocks.invoke).toHaveBeenCalledWith("browser_destroy", { tabId });
    expect(Object.values(useTabStore.getState().tabs).flat()).toEqual([]);
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
    expect(waiter.settled()).toEqual({ kind: "disabled", tabId: ORPHAN_TAB, navigationId: "nav-1" });
    cleanup();
  });

  it("also tears down tabs when the AI posture changes", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    const tabId = useTabStore.getState().createBrowserTab("main", URL, "Example", "ai-sandbox");
    const humanId = useTabStore.getState().createBrowserTab("main", URL, "Human", "human");
    const cleanup = startBrowserAiPolicySync();
    const waiter = pendingWaiter();

    useSettingsStore.getState().updateBrowserSetting("aiSession", "shared");
    await flush();

    expect(mocks.invoke).toHaveBeenCalledWith("browser_destroy", { tabId });
    expect(mocks.invoke).not.toHaveBeenCalledWith("browser_destroy", { tabId: humanId });
    expect(useTabStore.getState().findTabById(humanId)).toBeDefined();
    expect(waiter.settled()?.kind).toBe("disabled");
    cleanup();
  });

  it("tears down AI tabs when loopback policy changes, but preserves human tabs", () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    const aiId = useTabStore.getState().createBrowserTab("main", URL, "AI", "ai-sandbox");
    const humanId = useTabStore.getState().createBrowserTab("main", URL, "Human", "human");
    const cleanup = startBrowserAiPolicySync();

    useSettingsStore.getState().updateBrowserSetting("aiAllowLoopback", true);

    expect(mocks.invoke).toHaveBeenCalledWith("browser_destroy", { tabId: aiId });
    expect(mocks.invoke).not.toHaveBeenCalledWith("browser_destroy", { tabId: humanId });
    expect(useTabStore.getState().findTabById(aiId)).toBeNull();
    expect(useTabStore.getState().findTabById(humanId)).toBeDefined();
    cleanup();
  });

  it("does not push or tear down for an unchanged settings snapshot", async () => {
    const cleanup = startBrowserAiPolicySync();
    const calls = mocks.invoke.mock.calls.length;
    const waiter = pendingWaiter();

    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    await flush();

    expect(mocks.invoke.mock.calls).toHaveLength(calls);
    expect(waiter.settled()).toBeUndefined();
    cleanup();
  });
});
