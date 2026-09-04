// @vitest-environment node
// WI-N2.3 / WI-N2.6 — browser navigation handlers and bounded wait results.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  respond: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  latestNavigationId: vi.fn(),
  ensureNative: vi.fn(),
  destroyNative: vi.fn<(tabId: string) => Promise<void>>(() => Promise.resolve()),
  nativeReady: vi.fn(),
  hasNative: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...args: unknown[]) => mocks.respond(...args) }));
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
vi.mock("@/services/browser/browserNativeViews", () => ({
  ensureBrowserNativeView: (...args: unknown[]) => mocks.ensureNative(...args),
  destroyBrowserNativeView: (tabId: string) => mocks.destroyNative(tabId),
  waitForBrowserNativeView: (...args: unknown[]) => mocks.nativeReady(...args),
  hasBrowserNativeView: (...args: unknown[]) => mocks.hasNative(...args),
}));

import wire from "@/test/fixtures/commandErrorWire.json";
import { handleBrowserNavigate, handleBrowserOpen, handleBrowserWait } from "@/services/mcpBridge/v2/browserNavigation";
import { startBrowserTabLifecycle } from "@/services/browser/browserTabLifecycle";

// Production wiring: a discarded provisional tab is torn down by the tab-removal
// lifecycle, not by a direct browser_destroy from the handler.
startBrowserTabLifecycle();
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";

const URL = "https://example.com/start";

function resetTabs(): void {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
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
  mocks.hasNative.mockReset().mockReturnValue(true);
  resetTabs();
  useBrowserApprovalStore.setState({
    grants: [],
    pending: [],
    oneShots: [],
    attachments: [],
    profileOpens: [],
  });
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
    // open now passes an optional profile (WI-P6.1) — undefined when not supplied.
    expect(mocks.ensureNative).toHaveBeenCalledWith(tabs[0].id, URL, "ai-sandbox", undefined);
    expect(lastResponse()).toMatchObject({ id: "open-1", success: true });
  });

  it("refuses a request id already pending for a DIFFERENT request instead of reporting it queued (#56)", async () => {
    useBrowserApprovalStore.getState().requestApproval("dup", "https://evil.example/", "click", undefined, "tab-1", 1);
    await handleBrowserOpen("dup", { url: URL, profile: "github_work" });
    expect(lastResponse().success).toBe(false);
    expect(String(lastResponse().error)).toContain("different approval");
    expect(mocks.ensureNative).not.toHaveBeenCalled();
    // The original prompt is untouched: nothing was added or replaced under that id.
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "click" });
  });

  it("opening a named profile without approval raises a prompt and creates NO tab (WI-P6.1 H1)", async () => {
    await handleBrowserOpen("p-1", { url: URL, profile: "github_work" });
    expect(lastResponse()).toMatchObject({ success: false });
    expect((lastResponse().data as { needsApproval?: boolean; action?: string }).needsApproval).toBe(true);
    expect((lastResponse().data as { action?: string }).action).toBe("open-profile");
    // No tab, and the native create was never invoked — a guessed profile can't leak.
    expect(Object.values(useTabStore.getState().tabs).flat()).toEqual([]);
    expect(mocks.ensureNative).not.toHaveBeenCalled();
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "session", profile: "github_work" });
  });

  it("opens a named profile once a profile-open grant exists, forwarding the profile", async () => {
    useBrowserApprovalStore.setState({
      profileOpens: [{ profile: "github_work", originPattern: "https://example.com" }],
    });
    await handleBrowserOpen("p-2", { url: URL, profile: "github_work" });
    const tabs = useTabStore.getState().tabs.main;
    expect(tabs).toHaveLength(1);
    expect(mocks.ensureNative).toHaveBeenCalledWith(tabs[0].id, URL, "ai-sandbox", "github_work");
    // The grant is single-use — spent.
    expect(useBrowserApprovalStore.getState().profileOpens).toEqual([]);
  });

  it.each([["has space"], [""], ["  "]])(
    "rejects a PRESENT but malformed profile %j instead of silently opening an unnamed tab",
    async (badProfile) => {
      // Re-verify WI-P6.1 Validation: a bad profile name — including empty/whitespace —
      // must NOT downgrade to an unnamed sandbox tab (a different posture) — it is refused.
      await handleBrowserOpen("bad-prof", { url: URL, profile: badProfile });
      expect(lastResponse()).toMatchObject({ success: false, error: "INVALID_PROFILE" });
      expect(Object.values(useTabStore.getState().tabs).flat()).toEqual([]);
      expect(mocks.ensureNative).not.toHaveBeenCalled();
    },
  );

  it("stamps the committed generation so the first read/act is not rejected as stale", async () => {
    // Regression: `open` waits on the broker for the initial load, but that
    // loaded event fires before BrowserSurface mounts its own nav-event
    // listener — so without persisting the generation here the tab keeps
    // `generation: undefined`, resolveBrowserTab defaults it to 0, and the
    // driver rejects the very first read/act as a stale command until some
    // unrelated navigation happens to sync it.
    await handleBrowserOpen("open-gen", { url: URL });
    expect((useTabStore.getState().tabs.main[0] as { generation?: number }).generation).toBe(1);
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
    mocks.ensureNative.mockRejectedValueOnce(wire.browserApprovalRequired);

    await handleBrowserOpen("approval", { url: URL });

    expect(lastResponse()).toMatchObject({ error: "APPROVAL_REQUIRED" });
    const pending = useBrowserApprovalStore.getState().pending[0];
    expect(pending).toMatchObject({ operation: "navigate", targetUrl: URL });
    // Audit L-02: the tab RECORD stays — the prompt is about this page and the
    // one-shot it mints is bound to this tabId — and the client is told the retry
    // verb, because a fresh `open` would create a tab the one-shot cannot match.
    const tabs = Object.values(useTabStore.getState().tabs).flat();
    expect(tabs).toHaveLength(1);
    expect(pending.tabId).toBe(tabs[0].id);
    expect(lastResponse().data).toMatchObject({ retry: { action: "navigate", tabId: tabs[0].id } });
  });

  it("navigate on a tab whose creation is still owed completes it and waits on the creation ticket (L-02)", async () => {
    useSettingsStore.getState().updateBrowserSetting("aiSession", "shared");
    const tabId = seed("ai-shared");
    mocks.hasNative.mockReturnValue(false);

    await handleBrowserNavigate("nav-owed", { tabId, url: URL, timeoutMs: 1000 });

    expect(mocks.ensureNative).toHaveBeenCalledWith(tabId, URL, "ai-shared");
    // Creating IS the navigation the user approved; a second navigate would ask again.
    expect(mocks.invoke).not.toHaveBeenCalledWith("browser_ai_navigate", expect.anything());
    expect(mocks.invoke).toHaveBeenCalledWith("browser_ai_state", { tabId });
    expect(lastResponse()).toMatchObject({ id: "nav-owed", success: true });
  });

  it("removes the provisional tab when native AI creation fails", async () => {
    mocks.ensureNative.mockRejectedValueOnce("SSRF_BLOCKED");

    await handleBrowserOpen("open-failed", { url: URL });

    expect(Object.values(useTabStore.getState().tabs).flat()).toEqual([]);
    expect(mocks.destroyNative).toHaveBeenCalledWith(expect.any(String));
    expect(lastResponse()).toMatchObject({ success: false, error: "SSRF_BLOCKED" });
  });
});

describe("navigate", () => {
  it("activates an AI tab and waits for its navigation ticket", async () => {
    const tabId = seed();
    await handleBrowserNavigate("nav-1", { tabId, url: URL, timeoutMs: 1000 });

    // One budget: the native-view wait and the navigation wait both draw on the
    // request's single deadline (audit, timing), so neither may exceed timeoutMs.
    const nativeWait = mocks.nativeReady.mock.calls[0];
    expect(nativeWait[0]).toBe(tabId);
    expect(nativeWait[1]).toBeLessThanOrEqual(1000);
    expect(mocks.wait.mock.calls[0][2]).toBeLessThanOrEqual(1000);
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
    expect((useTabStore.getState().findTabById(tabId) as { generation?: number } | null)?.generation).toBe(1);
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

    // An untyped mount failure names the window AND carries the driver's reason.
    expect(lastResponse()).toMatchObject({
      error: "WINDOW_UNAVAILABLE: native view unavailable",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("browser_ai_navigate", expect.anything());
  });

  it("responds queue-full (NOT needsApproval) when the approval queue is at capacity", async () => {
    const { MAX_PENDING_APPROVALS } = await import("@/stores/browserApprovalStore");
    const tabId = seed("ai-shared");
    const store = useBrowserApprovalStore.getState();
    for (let i = 0; i < MAX_PENDING_APPROVALS; i++) {
      store.requestApproval(`fill-${i}`, URL, "click", { role: "button", name: `b${i}` } as never, tabId, 1);
    }
    mocks.ensureNative.mockRejectedValueOnce(wire.browserApprovalRequired);

    await handleBrowserNavigate("nav-full", { tabId, url: URL });

    const res = lastResponse();
    expect(String(res.error)).toContain("approval queue is full");
    expect((res.data as { needsApproval?: boolean } | undefined)?.needsApproval).toBeUndefined();
  });

  it("queues approval when Rust rejects the destination", async () => {
    const tabId = seed("ai-shared");
    mocks.ensureNative.mockRejectedValueOnce(wire.browserApprovalRequired);

    await handleBrowserNavigate("nav-approval", { tabId, url: URL });

    expect(lastResponse()).toMatchObject({ error: "APPROVAL_REQUIRED" });
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({
      tabId,
      operation: "navigate",
    });
  });
});

// WI-14 — the handlers against the TYPED rejection Rust sends. Rejection values
// come from the fixture the Rust suite generates, so a code rename fails here
// rather than silently disabling the approval flow — which is exactly what a
// substring match on the message would have done. Round 4 (#48) removed the
// legacy-string fallback outright: every browser command is typed, so a bare
// string or Error that merely CONTAINS the token is a failure, never a prompt.
describe("typed CommandError rejections", () => {
  it("queues an approval for code approval-required, not for a lookalike message", async () => {
    const tabId = seed("ai-shared");
    mocks.ensureNative.mockRejectedValueOnce(wire.browserApprovalRequired);

    await handleBrowserNavigate("typed-approval", { tabId, url: URL });

    expect(lastResponse()).toMatchObject({ error: "APPROVAL_REQUIRED" });
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({
      tabId,
      operation: "navigate",
    });
  });

  it("does NOT queue an approval for a permission-denied refusal", async () => {
    // Security-load-bearing: no user approval can lift an SSRF block, so
    // raising a prompt for it would teach the user to approve the unapprovable.
    const tabId = seed("ai-shared");
    mocks.ensureNative.mockRejectedValueOnce({
      code: "permission-denied",
      message: "AI navigation to this destination is blocked by policy",
      detail: { kind: "ssrf-blocked", mcpCode: "SSRF_BLOCKED" },
    });

    await handleBrowserNavigate("typed-denied", { tabId, url: URL });

    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
    // The typed refusal keeps its token (it used to be flattened to
    // WINDOW_UNAVAILABLE, hiding the reason from the model) and now travels with
    // its message and the classifier's detail, not as a bare word.
    expect(lastResponse()).toMatchObject({
      error: "SSRF_BLOCKED: AI navigation to this destination is blocked by policy",
      data: {
        code: "permission-denied",
        token: "SSRF_BLOCKED",
        mcpCode: "SSRF_BLOCKED",
        detail: { kind: "ssrf-blocked" },
      },
    });
  });

  it("reports the MCP token the client already knows, never [object Object]", async () => {
    mocks.ensureNative.mockRejectedValueOnce({
      code: "permission-denied",
      message: "AI navigation to this destination is blocked by policy",
      detail: { mcpCode: "SSRF_BLOCKED" },
    });

    await handleBrowserOpen("typed-open-failed", { url: URL });

    expect(lastResponse()).toMatchObject({
      success: false,
      error: "SSRF_BLOCKED: AI navigation to this destination is blocked by policy",
      data: { token: "SSRF_BLOCKED" },
    });
    expect(Object.values(useTabStore.getState().tabs).flat()).toEqual([]);
  });

  it("derives a token from the code when Rust attached no MCP token", async () => {
    mocks.ensureNative.mockRejectedValueOnce({ code: "conflict", message: "duplicate tab" });

    await handleBrowserOpen("typed-open-conflict", { url: URL });

    expect(lastResponse()).toMatchObject({
      success: false,
      error: "CONFLICT: duplicate tab",
      data: { code: "conflict", token: "CONFLICT" },
    });
  });

  it("passes a typed browser_ai_navigate refusal through to the approval flow", async () => {
    const tabId = seed("ai-shared");
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "browser_ai_navigate") return Promise.reject(wire.browserApprovalRequired);
      return undefined;
    });

    await handleBrowserNavigate("typed-invoke-approval", { tabId, url: URL });

    expect(lastResponse()).toMatchObject({ error: "APPROVAL_REQUIRED" });
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ tabId });
  });

  it("does NOT queue an approval for an UNTYPED rejection that merely contains the token (round 4, #48)", async () => {
    const tabId = seed("ai-shared");
    mocks.ensureNative.mockRejectedValueOnce(new Error("APPROVAL_REQUIRED"));

    await handleBrowserNavigate("untyped-native", { tabId, url: URL });

    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
    const native = lastResponse();
    expect(native).toMatchObject({ success: false, error: "WINDOW_UNAVAILABLE: APPROVAL_REQUIRED" });
    expect(native.data).toBeUndefined();

    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "browser_ai_navigate") return Promise.reject("APPROVAL_REQUIRED");
      return undefined;
    });

    await handleBrowserNavigate("untyped-invoke", { tabId, url: URL });

    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
    const invoked = lastResponse();
    expect(invoked).toMatchObject({ success: false, error: "APPROVAL_REQUIRED" });
    expect(invoked.data).toBeUndefined();
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

  // Audit L-03: `wait` is advertised read-only. It must observe, never focus a
  // window, activate a tab, or create a native view.
  it("observes only: no focus change, no activation, no view creation", async () => {
    const other = useTabStore.getState().createTab("main");
    const tabId = seed();
    useTabStore.getState().setActiveTab("main", other);

    await handleBrowserWait("observe", { tabId, navigationId: "nav-1" });

    expect(mocks.invoke).not.toHaveBeenCalledWith("focus_window", expect.anything());
    expect(mocks.ensureNative).not.toHaveBeenCalled();
    expect(mocks.nativeReady).not.toHaveBeenCalled();
    expect(useTabStore.getState().activeTabId.main).toBe(other);
    expect(lastResponse()).toMatchObject({ id: "observe", success: true });
  });

  it("reports a tab with no native view as idle instead of creating one", async () => {
    const tabId = seed();
    mocks.hasNative.mockReturnValue(false);
    await handleBrowserWait("no-view", { tabId });
    expect(mocks.ensureNative).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ id: "no-view", success: true, data: { tabId, loading: false } });
  });
});

// WI-NB2.2 — gate detection on navigation results. A loaded navigation runs one
// best-effort read-class signals eval; a classified gate rides the result as
// `data.gate {kind, hint}`. Advisory only: probe failure or an ordinary page
// changes nothing about the navigation result.
describe("gate detection on loaded results (WI-NB2.2)", () => {
  function withEvalSignals(signals: Record<string, unknown> | Error): void {
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "browser_ai_navigate") return { tabId: args?.tabId, navigationId: "nav-1" };
      if (command === "browser_ai_state") {
        return { tabId: args?.tabId, url: URL, generation: 1, loading: false, navigationId: "nav-1" };
      }
      if (command === "browser_eval") {
        if (signals instanceof Error) throw signals;
        return JSON.stringify(signals);
      }
      return undefined;
    });
  }

  it("attaches a login-required gate when the landed page signals one", async () => {
    const tabId = seed();
    withEvalSignals({
      url: "https://example.com/login",
      title: "Sign in — Example",
      textHead: "Username. Password.",
      challengeWidget: false,
      passwordField: true,
    });
    await handleBrowserNavigate("g-1", { tabId, url: URL, timeoutMs: 1000 });
    const data = lastResponse().data as { gate?: { kind: string; hint: string } };
    expect(data.gate?.kind).toBe("login-required");
    expect(data.gate?.hint).toContain("user");
  });

  it("attaches no gate for an ordinary page", async () => {
    const tabId = seed();
    withEvalSignals({
      url: URL,
      title: "Example",
      textHead: "Ordinary content.",
      challengeWidget: false,
      passwordField: false,
    });
    await handleBrowserNavigate("g-2", { tabId, url: URL, timeoutMs: 1000 });
    expect(lastResponse()).toMatchObject({ success: true });
    expect("gate" in (lastResponse().data as Record<string, unknown>)).toBe(false);
  });

  it("a failing probe never degrades the navigation result", async () => {
    const tabId = seed();
    withEvalSignals(new Error("stale generation"));
    await handleBrowserNavigate("g-3", { tabId, url: URL, timeoutMs: 1000 });
    expect(lastResponse()).toMatchObject({ id: "g-3", success: true });
    expect("gate" in (lastResponse().data as Record<string, unknown>)).toBe(false);
  });
});
