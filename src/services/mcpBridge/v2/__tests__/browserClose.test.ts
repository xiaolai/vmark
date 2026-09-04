// @vitest-environment node
// Audit 2026-09-03 X-01 — the AI can close its own tabs (never gated); never a human's.
import { describe, it, expect, beforeEach, vi } from "vitest";

const respond = vi.fn();
const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...a: unknown[]) => respond(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: Parameters<typeof invoke>) => invoke(...a) }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { handleBrowserClose } from "@/services/mcpBridge/v2/browserClose";

beforeEach(() => {
  respond.mockReset();
  invoke.mockReset().mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled: true } }));
  useTabStore.setState({ tabs: { main: [] }, activeTabId: { main: null } });
});

describe("handleBrowserClose", () => {
  it("closes an AI-owned tab and reports it once the driver confirmed the native teardown", async () => {
    const tabId = useTabStore.getState().createBrowserTab("main", "https://a.com/", undefined, "ai-sandbox");
    await handleBrowserClose("c1", { tabId });
    expect(respond).toHaveBeenCalledWith({ id: "c1", success: true, data: { tabId, closed: true, destroyed: true } });
    expect(useTabStore.getState().findTabById(tabId)).toBeNull();
    expect(invoke).toHaveBeenCalledWith("browser_destroy", { tabId });
  });

  // Round 3, #44 — closure used to be reported the moment the frontend record went,
  // while the native teardown ran fire-and-forget and swallowed its failure.
  it("responds success:false with a typed token when the native teardown could not be confirmed", async () => {
    const tabId = useTabStore.getState().createBrowserTab("main", "https://a.com/", undefined, "ai-sandbox");
    invoke.mockImplementation(async (command) => {
      if (command === "browser_destroy") throw { code: "internal", message: "surface: main thread unavailable" };
    });
    await handleBrowserClose("c-fail", { tabId });
    const res = respond.mock.calls.at(-1)?.[0] as { success: boolean; error: string; data: Record<string, unknown> };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^TAB_TEARDOWN_FAILED: /);
    expect(res.error).toContain("main thread unavailable");
    expect(res.error).not.toContain("[object Object]");
    // Honest about what did happen: the record is gone, the view is not confirmed gone.
    expect(res.data).toEqual({ token: "TAB_TEARDOWN_FAILED", tabId, closed: true, destroyed: false });
    expect(useTabStore.getState().findTabById(tabId)).toBeNull();
  });

  it("refuses a human tab and an unknown tab, and requires a tabId", async () => {
    const human = useTabStore.getState().createBrowserTab("main", "https://h.com/", undefined, "human");
    await handleBrowserClose("c2", { tabId: human });
    expect(respond).toHaveBeenLastCalledWith({ id: "c2", success: false, error: "TAB_NOT_AI_OWNED" });
    expect(useTabStore.getState().findTabById(human)).not.toBeNull();
    await handleBrowserClose("c3", { tabId: "nope" });
    expect(respond).toHaveBeenLastCalledWith({ id: "c3", success: false, error: "TAB_NOT_FOUND" });
    await handleBrowserClose("c4", {});
    expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c4", success: false }));
  });
});
