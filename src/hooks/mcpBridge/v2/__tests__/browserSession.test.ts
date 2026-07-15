// WI-P6.2/P6.3/P6.6 — session save/load: per-call user approval (op `session`,
// never grantable, payload-bound to action:handle), handle-only responses.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { respond } from "../../utils";
import { handleBrowserSessionSave, handleBrowserSessionLoad } from "../browserSession";
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
function lastResponse() {
  const c = vi.mocked(respond).mock.calls;
  return c[c.length - 1][0];
}
function saveCall() {
  return invoke.mock.calls.find((c) => c[0] === "browser_save_storage_state")?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("handleBrowserSessionSave (op=session, never grantable)", () => {
  it("requires a fresh per-call approval — a grant never authorizes it", () => {
    const id = seed();
    // Even if the vocabulary somehow let it be granted, session is stripped.
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["session"]);
    expect(useBrowserApprovalStore.getState().grants).toEqual([]);
    void id;
  });

  it("raises approval, then saves and returns a handle + summary (no values)", async () => {
    const id = seed();
    await handleBrowserSessionSave("sv-a", { tabId: id, handle: "work_login" });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "session" });

    useBrowserApprovalStore.getState().resolveApproval("sv-a", "once");
    invoke.mockResolvedValue("2 cookie(s), 1 origin(s), 3 localStorage item(s)");
    await handleBrowserSessionSave("sv-b", { tabId: id, handle: "work_login" });
    expect(saveCall()).toMatchObject({ handle: "work_login", generation: 1 });
    const res = lastResponse();
    expect(res).toMatchObject({ success: true, data: { handle: "work_login" } });
    // Handle + summary only — never a raw cookie/token value.
    expect(JSON.stringify(res.data)).not.toMatch(/token|secret|cookie-value/i);
  });

  it("refuses a bad handle without touching the driver", async () => {
    const id = seed();
    await handleBrowserSessionSave("sv-x", { tabId: id, handle: "../etc/passwd" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });
});

describe("handleBrowserSessionLoad (op=session)", () => {
  it("raises approval, then restores and returns only {loaded:true}", async () => {
    const id = seed();
    await handleBrowserSessionLoad("ld-a", { tabId: id, handle: "work_login" });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);

    useBrowserApprovalStore.getState().resolveApproval("ld-a", "once");
    invoke.mockResolvedValue(undefined);
    await handleBrowserSessionLoad("ld-b", { tabId: id, handle: "work_login" });
    expect(invoke).toHaveBeenCalledWith("browser_load_storage_state", expect.objectContaining({ handle: "work_login" }));
    expect(lastResponse()).toMatchObject({ success: true, data: { loaded: true } });
  });

  it("refuses a substituted handle under a prior Allow-once (approve A, load B)", async () => {
    const id = seed();
    await handleBrowserSessionLoad("sub-a", { tabId: id, handle: "work_login" });
    useBrowserApprovalStore.getState().resolveApproval("sub-a", "once");
    invoke.mockResolvedValue(undefined);
    // Approval bound load:work_login; a different handle must not ride it.
    await handleBrowserSessionLoad("sub-b", { tabId: id, handle: "other_account" });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);
  });
});
