// WI-N3.1 / WI-N4.4 — policy synchronization is fail-closed and tears down
// browser state when access or the data-store posture changes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  cancelPending: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("./browserEventBroker", () => ({
  browserEventBroker: {
    start: (...args: unknown[]) => mocks.start(...args),
    stop: (...args: unknown[]) => mocks.stop(...args),
    cancelPending: (...args: unknown[]) => mocks.cancelPending(...args),
  },
}));
vi.mock("@/utils/debug", () => ({ browserWarn: (...args: unknown[]) => mocks.warn(...args) }));

import { startBrowserAiPolicySync } from "./browserAiPolicySync";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";

const URL = "https://example.com/";

function reset() {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", false);
  useSettingsStore.getState().updateBrowserSetting("aiSession", "sandbox");
  useSettingsStore.getState().updateBrowserSetting("aiAllowLoopback", false);
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.start.mockReset().mockResolvedValue(undefined);
  mocks.stop.mockReset().mockResolvedValue(undefined);
  mocks.cancelPending.mockReset();
  mocks.warn.mockReset();
}

beforeEach(reset);

describe("startBrowserAiPolicySync", () => {
  it("pushes the initial policy and starts the event broker", () => {
    const cleanup = startBrowserAiPolicySync();

    expect(mocks.invoke).toHaveBeenCalledWith("browser_ai_policy", {
      enabled: false,
      session: "sandbox",
      allowLoopback: false,
    });
    expect(mocks.start).toHaveBeenCalledOnce();
    cleanup();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("destroys browser tabs and clears ephemeral approvals when disabled", () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    const tabId = useTabStore.getState().createBrowserTab("main", URL, "Example", "ai-sandbox");
    useBrowserApprovalStore.getState().requestApproval("pending", URL, "read", undefined, tabId, 0);
    const cleanup = startBrowserAiPolicySync();

    useSettingsStore.getState().updateBrowserSetting("enabled", false);

    expect(mocks.invoke).toHaveBeenCalledWith("browser_destroy", { tabId });
    expect(Object.values(useTabStore.getState().tabs).flat()).toEqual([]);
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
    expect(mocks.cancelPending).toHaveBeenCalled();
    cleanup();
  });

  it("also tears down tabs when the AI posture changes", () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", true);
    const tabId = useTabStore.getState().createBrowserTab("main", URL, "Example", "ai-sandbox");
    const humanId = useTabStore.getState().createBrowserTab("main", URL, "Human", "human");
    const cleanup = startBrowserAiPolicySync();

    useSettingsStore.getState().updateBrowserSetting("aiSession", "shared");

    expect(mocks.invoke).toHaveBeenCalledWith("browser_destroy", { tabId });
    expect(mocks.invoke).not.toHaveBeenCalledWith("browser_destroy", { tabId: humanId });
    expect(useTabStore.getState().findTabById(humanId)).toBeDefined();
    expect(mocks.cancelPending).toHaveBeenCalled();
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

  it("does not push or tear down for an unchanged settings snapshot", () => {
    const cleanup = startBrowserAiPolicySync();
    const calls = mocks.invoke.mock.calls.length;
    mocks.cancelPending.mockClear();

    useSettingsStore.getState().updateBrowserSetting("enabled", false);

    expect(mocks.invoke.mock.calls).toHaveLength(calls);
    expect(mocks.cancelPending).not.toHaveBeenCalled();
    cleanup();
  });
});
