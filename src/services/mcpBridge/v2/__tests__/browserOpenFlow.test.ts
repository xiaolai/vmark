// @vitest-environment node
// Round 3, #54 — the stages of `open` on their own: profile parsing, profile
// authorization (WI-P6.1 H1) against the real approval store, and the creation
// transaction against a mocked native layer.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  respond: vi.fn(),
  ensureNative: vi.fn<(...a: unknown[]) => Promise<void>>(),
  destroyNative: vi.fn<(tabId: string) => Promise<void>>(() => Promise.resolve()),
  wait: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: Parameters<typeof mocks.invoke>) => mocks.invoke(...a) }));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...a: unknown[]) => mocks.respond(...a) }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/browser/browserNativeViews", () => ({
  ensureBrowserNativeView: (...a: unknown[]) => mocks.ensureNative(...a),
  destroyBrowserNativeView: (tabId: string) => mocks.destroyNative(tabId),
  hasBrowserNativeView: () => false,
}));
vi.mock("@/services/browser/browserEventBroker", () => ({
  browserEventBroker: { start: async () => undefined, wait: (...a: unknown[]) => mocks.wait(...a) },
}));

import { MAX_PENDING_APPROVALS, useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useBrowserSessionStore } from "@/stores/browserSessionStore";
import { useTabStore } from "@/stores/tabStore";
import { startBrowserTabLifecycle } from "@/services/browser/browserTabLifecycle";
import { authorizeProfileOpen, createAiTab, readProfile } from "@/services/mcpBridge/v2/browserOpenFlow";

// Production wiring: a discarded provisional tab is torn down by the tab-removal lifecycle.
startBrowserTabLifecycle();

const URL = "https://example.com/start?code=SECRET";
function lastResponse() {
  return mocks.respond.mock.calls.at(-1)?.[0] as { id: string; success: boolean; error?: string; data?: Record<string, unknown> };
}
const tabs = () => Object.values(useTabStore.getState().tabs).flat();

beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "browser_ai_state") return { tabId: args?.tabId, url: URL, generation: 1, loading: false, navigationId: "nav-1" };
    return undefined;
  });
  mocks.respond.mockReset();
  mocks.ensureNative.mockReset().mockResolvedValue(undefined);
  mocks.destroyNative.mockClear();
  mocks.wait.mockReset().mockResolvedValue({ kind: "loaded", tabId: "x", navigationId: "nav-1", generation: 1, url: URL, title: "Example", loading: false });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
});

describe("readProfile", () => {
  it("reads an absent profile as none, and a valid one trimmed", () => {
    expect(readProfile(undefined)).toEqual({ ok: true, profile: undefined });
    expect(readProfile(null)).toEqual({ ok: true, profile: undefined });
    expect(readProfile("github_work")).toEqual({ ok: true, profile: "github_work" });
    expect(readProfile("  a.b-c_1  ")).toEqual({ ok: true, profile: "a.b-c_1" });
  });

  it.each([[""], ["   "], ["has space"], ["a/b"], ["x".repeat(65)], [42], [{}]])(
    "refuses a PRESENT but malformed profile %j instead of downgrading to an unnamed tab",
    (raw) => {
      expect(readProfile(raw)).toEqual({ ok: false });
    },
  );
});

describe("authorizeProfileOpen", () => {
  it("refuses a profile outside sandbox posture with its token, creating nothing", async () => {
    expect(await authorizeProfileOpen("p", URL, "github_work", "ai-shared")).toBe(false);
    expect(lastResponse()).toMatchObject({ success: false, data: { token: "PROFILE_REQUIRES_SANDBOX" } });
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
  });

  it("raises an open-profile prompt (origin only) when no grant exists", async () => {
    expect(await authorizeProfileOpen("p1", URL, "github_work", "ai-sandbox")).toBe(false);
    expect(useBrowserApprovalStore.getState().pending).toEqual([
      { id: "p1", targetUrl: URL, operation: "session", tabId: "", generation: 0, profile: "github_work" },
    ]);
    expect(lastResponse()).toEqual({
      id: "p1",
      success: false,
      error: "approval required: open profile 'github_work' on https://example.com",
      data: { needsApproval: true, operation: "session", action: "open-profile", profile: "github_work", url: "https://example.com" },
    });
    expect(JSON.stringify(lastResponse())).not.toContain("SECRET");
  });

  it("re-answers the same request without queueing twice, and refuses the same id for a DIFFERENT request", async () => {
    await authorizeProfileOpen("dup", URL, "github_work", "ai-sandbox");
    expect(await authorizeProfileOpen("dup", URL, "github_work", "ai-sandbox")).toBe(false);
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);
    expect(lastResponse().data).toMatchObject({ needsApproval: true });

    expect(await authorizeProfileOpen("dup", URL, "other_profile", "ai-sandbox")).toBe(false);
    expect(lastResponse()).toEqual({ id: "dup", success: false, error: "a different approval is already pending under this request id" });
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);
  });

  it("refuses over the cap as queue-full, never as needsApproval", async () => {
    const store = useBrowserApprovalStore.getState();
    for (let i = 0; i < MAX_PENDING_APPROVALS; i++) {
      store.requestApproval(`fill-${i}`, URL, "click", { role: "button", name: `b${i}` }, "t", 1);
    }
    expect(await authorizeProfileOpen("full", URL, "github_work", "ai-sandbox")).toBe(false);
    expect(lastResponse().error).toContain("approval queue is full");
    expect(lastResponse().data).toBeUndefined();
  });

  it("spends the single-use grant once the driver confirms the mint", async () => {
    useBrowserApprovalStore.setState({ profileOpens: [{ profile: "github_work", originPattern: "https://example.com" }] });
    expect(await authorizeProfileOpen("ok", URL, "github_work", "ai-sandbox")).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("browser_add_profile_open", { profile: "github_work", originPattern: "https://example.com" });
    expect(useBrowserApprovalStore.getState().profileOpens).toEqual([]);
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("does not match a grant for another profile or origin", async () => {
    useBrowserApprovalStore.setState({
      profileOpens: [
        { profile: "other", originPattern: "https://example.com" },
        { profile: "github_work", originPattern: "https://elsewhere.example" },
      ],
    });
    expect(await authorizeProfileOpen("nm", URL, "github_work", "ai-sandbox")).toBe(false);
    expect(lastResponse().data).toMatchObject({ needsApproval: true, action: "open-profile" });
    expect(useBrowserApprovalStore.getState().profileOpens).toHaveLength(2);
  });

  it("refuses with PROFILE_NOT_APPROVED when the driver refuses the mint, keeping the mirror's grant for the retry", async () => {
    const grant = { profile: "github_work", originPattern: "https://example.com" };
    useBrowserApprovalStore.setState({ profileOpens: [grant] });
    mocks.invoke.mockRejectedValue({ code: "conflict", message: "no such profile" });
    expect(await authorizeProfileOpen("nm", URL, "github_work", "ai-sandbox")).toBe(false);
    expect(lastResponse()).toMatchObject({ success: false, data: { token: "PROFILE_NOT_APPROVED" } });
    expect(useBrowserApprovalStore.getState().profileOpens).toEqual([grant]);
  });
});

describe("createAiTab", () => {
  const deadline = () => Date.now() + 1000;

  it("creates the record, the native view (profile forwarded), records the profile use and answers the creation ticket", async () => {
    await createAiTab("c1", "main", URL, "ai-sandbox", "github_work", deadline());
    const [tab] = tabs();
    expect(tab).toMatchObject({ kind: "browser", automationMode: "ai-sandbox", url: URL });
    expect(mocks.ensureNative).toHaveBeenCalledWith(tab.id, URL, "ai-sandbox", "github_work");
    expect(useBrowserSessionStore.getState().profiles.map((p) => p.name)).toEqual(["github_work"]);
    expect(lastResponse()).toMatchObject({ id: "c1", success: true, data: { tabId: tab.id, navigationId: "nav-1", loading: false } });
  });

  it("keeps the provisional tab on a shared destination refusal and names the retry verb (L-02)", async () => {
    mocks.ensureNative.mockRejectedValueOnce({ code: "approval-required", message: "needs approval" });
    await createAiTab("c2", "main", URL, "ai-shared", undefined, deadline());
    const [tab] = tabs();
    expect(tab).toBeDefined();
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "navigate", tabId: tab.id, targetUrl: URL });
    expect(lastResponse()).toMatchObject({
      error: "APPROVAL_REQUIRED",
      data: { needsApproval: true, retry: { action: "navigate", tabId: tab.id } },
    });
    expect(mocks.destroyNative).not.toHaveBeenCalled();
  });

  it("discards the provisional tab when the destination prompt cannot be queued", async () => {
    const store = useBrowserApprovalStore.getState();
    for (let i = 0; i < MAX_PENDING_APPROVALS; i++) {
      store.requestApproval(`fill-${i}`, URL, "click", { role: "button", name: `b${i}` }, "t", 1);
    }
    mocks.ensureNative.mockRejectedValueOnce({ code: "approval-required", message: "needs approval" });
    await createAiTab("c3", "main", URL, "ai-shared", undefined, deadline());
    expect(tabs()).toEqual([]);
    expect(mocks.destroyNative).toHaveBeenCalledTimes(1);
    expect(lastResponse().error).toContain("approval queue is full");
  });

  it("discards the provisional tab on any other creation failure and reports the typed refusal", async () => {
    mocks.ensureNative.mockRejectedValueOnce({ code: "permission-denied", message: "blocked", detail: { mcpCode: "SSRF_BLOCKED" } });
    await createAiTab("c4", "main", URL, "ai-sandbox", undefined, deadline());
    expect(tabs()).toEqual([]);
    expect(mocks.destroyNative).toHaveBeenCalledTimes(1);
    expect(lastResponse()).toMatchObject({ success: false, error: "SSRF_BLOCKED: blocked", data: { token: "SSRF_BLOCKED" } });
  });
});
