// WI-N2.3 / WI-N2.6 — browser navigation handlers and bounded wait results.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  respond: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  latestNavigationId: vi.fn(),
  ensureNative: vi.fn(),
  nativeReady: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("../../utils", () => ({ respond: (...args: unknown[]) => mocks.respond(...args) }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@/services/browser/browserEventBroker", () => ({
  browserEventBroker: {
    start: (...args: unknown[]) => mocks.start(...args),
    wait: (...args: unknown[]) => mocks.wait(...args),
    latestNavigationId: (...args: unknown[]) => mocks.latestNavigationId(...args),
  },
}));
vi.mock("@/components/Browser/useBrowserNativeView", () => ({
  ensureBrowserNativeView: (...args: unknown[]) => mocks.ensureNative(...args),
  waitForBrowserNativeView: (...args: unknown[]) => mocks.nativeReady(...args),
}));

import { handleBrowserNavigate, handleBrowserOpen, handleBrowserWait } from "../browserNavigation";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";

const URL = "https://example.com/start";

function resetTabs(): void {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
}

function seed(mode: "ai-sandbox" | "ai-shared" | "human" = "ai-sandbox"): string {
  return useTabStore.getState().createBrowserTab("main", URL, "Example", mode);
}

function lastResponse(): Record<string, unknown> {
  return mocks.respond.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function loaded(navigationId = "nav-1") {
  return {
    kind: "loaded",
    tabId: "ignored-by-handler",
    navigationId,
    generation: 1,
    url: URL,
    title: "Example",
    loading: false,
  };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.respond.mockReset();
  mocks.start.mockReset().mockResolvedValue(undefined);
  mocks.wait.mockReset().mockResolvedValue(loaded());
  mocks.latestNavigationId.mockReset().mockReturnValue("nav-1");
  mocks.ensureNative.mockReset().mockResolvedValue(undefined);
  mocks.nativeReady.mockReset().mockResolvedValue(undefined);
  resetTabs();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
  useSettingsStore.getState().updateBrowserSetting("aiSession", "sandbox");
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "browser_ai_navigate") {
      return { tabId: args?.tabId, navigationId: "nav-1" };
    }
    if (command === "browser_ai_state") {
      return { tabId: args?.tabId, url: URL, generation: 1, loading: false, navigationId: "nav-1" };
    }
    return undefined;
  });
});

describe("open", () => {
  it("creates an AI tab, starts a ticket, and returns the loaded result", async () => {
    await handleBrowserOpen("open-1", { url: URL });

    const tabs = useTabStore.getState().tabs.main;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ automationMode: "ai-sandbox", url: URL });
    expect(mocks.ensureNative).toHaveBeenCalledWith(tabs[0].id, URL, "ai-sandbox");
    expect(lastResponse()).toMatchObject({ id: "open-1", success: true });
  });

  it("stamps the committed generation so the first read/act is not rejected as stale", async () => {
    // Regression: `open` waits on the broker for the initial load, but that
    // loaded event fires before BrowserSurface mounts its own nav-event
    // listener — so without persisting the generation here the tab keeps
    // `generation: undefined`, resolveBrowserTab defaults it to 0, and the
    // driver rejects the very first read/act as a stale command until some
    // unrelated navigation happens to sync it.
    await handleBrowserOpen("open-gen", { url: URL });
    expect(useTabStore.getState().tabs.main[0].generation).toBe(1);
  });

  it.each([
    [{ url: "" }, "INVALID_URL"],
    [{ url: URL, timeoutMs: 0 }, "INVALID_TIMEOUT"],
  ])("rejects malformed input %#", async (args, error) => {
    await handleBrowserOpen(`bad-${error}`, args);
    expect(lastResponse()).toMatchObject({ success: false, error });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not create a tab while the browser feature is disabled", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    await handleBrowserOpen("off", { url: URL });
    expect(lastResponse()).toMatchObject({ success: false, error: "BROWSER_DISABLED" });
    expect(Object.values(useTabStore.getState().tabs).flat()).toEqual([]);
  });

  it("turns a shared destination refusal into a pending navigation approval", async () => {
    useSettingsStore.getState().updateBrowserSetting("aiSession", "shared");
    mocks.ensureNative.mockRejectedValueOnce("APPROVAL_REQUIRED");

    await handleBrowserOpen("approval", { url: URL });

    expect(lastResponse()).toMatchObject({ error: "APPROVAL_REQUIRED" });
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({
      operation: "navigate",
      targetUrl: URL,
    });
  });

  it("removes the provisional tab when native AI creation fails", async () => {
    mocks.ensureNative.mockRejectedValueOnce("SSRF_BLOCKED");

    await handleBrowserOpen("open-failed", { url: URL });

    expect(Object.values(useTabStore.getState().tabs).flat()).toEqual([]);
    expect(mocks.invoke).toHaveBeenCalledWith("browser_destroy", expect.anything());
    expect(lastResponse()).toMatchObject({ success: false, error: "SSRF_BLOCKED" });
  });
});

describe("navigate", () => {
  it("activates an AI tab and waits for its navigation ticket", async () => {
    const tabId = seed();
    await handleBrowserNavigate("nav-1", { tabId, url: URL, timeoutMs: 1000 });

    expect(mocks.nativeReady).toHaveBeenCalledWith(tabId, 1000);
    expect(mocks.ensureNative).toHaveBeenCalledWith(tabId, URL, "ai-sandbox");
    expect(mocks.invoke).toHaveBeenCalledWith(
      "browser_ai_navigate",
      expect.objectContaining({ tabId, url: URL }),
    );
    expect(lastResponse()).toMatchObject({ id: "nav-1", success: true });
  });

  it("stamps the committed generation when a navigation completes", async () => {
    const tabId = seed();
    await handleBrowserNavigate("nav-gen", { tabId, url: URL, timeoutMs: 1000 });
    expect(useTabStore.getState().findTabById(tabId)?.generation).toBe(1);
  });

  it("refuses human-owned tabs and missing targets", async () => {
    const humanId = seed("human");
    await handleBrowserNavigate("human", { tabId: humanId, url: URL });
    expect(lastResponse()).toMatchObject({ error: "TAB_NOT_AI_OWNED" });

    await handleBrowserNavigate("missing", { tabId: "no-such-tab", url: URL });
    expect(lastResponse()).toMatchObject({ error: "TAB_NOT_FOUND" });
  });

  it("returns WINDOW_UNAVAILABLE when the owning native view cannot mount", async () => {
    const tabId = seed();
    mocks.ensureNative.mockRejectedValueOnce(new Error("native view unavailable"));

    await handleBrowserNavigate("window", { tabId, url: URL });

    expect(lastResponse()).toMatchObject({ error: "WINDOW_UNAVAILABLE" });
    expect(mocks.invoke).not.toHaveBeenCalledWith("browser_ai_navigate", expect.anything());
  });

  it("queues approval when Rust rejects the destination", async () => {
    const tabId = seed("ai-shared");
    mocks.ensureNative.mockRejectedValueOnce("APPROVAL_REQUIRED");

    await handleBrowserNavigate("nav-approval", { tabId, url: URL });

    expect(lastResponse()).toMatchObject({ error: "APPROVAL_REQUIRED" });
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({
      tabId,
      operation: "navigate",
    });
  });
});

describe("wait", () => {
  it.each([
    ["failed", "NAVIGATION_FAILED"],
    ["superseded", "NAVIGATION_SUPERSEDED"],
    ["timeout", "TIMEOUT"],
    ["disabled", "BROWSER_DISABLED"],
  ])("maps a %s broker result to a stable error", async (kind, error) => {
    const tabId = seed();
    mocks.wait.mockResolvedValueOnce({ kind, tabId, navigationId: "nav-1", message: "nope" });

    await handleBrowserWait(`wait-${kind}`, { tabId, navigationId: "nav-1" });

    expect(lastResponse()).toMatchObject({ success: false, error });
  });

  it("returns the current AI state when no navigation is in flight", async () => {
    const tabId = seed();
    mocks.latestNavigationId.mockReturnValueOnce(undefined);

    await handleBrowserWait("idle", { tabId });

    expect(mocks.invoke).toHaveBeenCalledWith("browser_ai_state", { tabId });
    expect(lastResponse()).toMatchObject({ id: "idle", success: true });
  });

  it("rejects invalid navigation ids without touching the driver", async () => {
    const tabId = seed();
    await handleBrowserWait("bad-navigation", { tabId, navigationId: " " });
    expect(lastResponse()).toMatchObject({ error: "INVALID_NAVIGATION" });
    expect(mocks.invoke).not.toHaveBeenCalledWith("browser_ai_state", expect.anything());
  });
});
