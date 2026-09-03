// @vitest-environment node
// Audit 2026-09-03 X-01 — the AI can close its own tabs (never gated); never a human's.
import { describe, it, expect, beforeEach, vi } from "vitest";

const respond = vi.fn();
vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...a: unknown[]) => respond(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { handleBrowserClose } from "@/services/mcpBridge/v2/browserClose";

beforeEach(() => {
  respond.mockReset();
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled: true } }));
  useTabStore.setState({ tabs: { main: [] }, activeTabId: { main: null } });
});

describe("handleBrowserClose", () => {
  it("closes an AI-owned tab and reports it", async () => {
    const tabId = useTabStore.getState().createBrowserTab("main", "https://a.com/", undefined, "ai-sandbox");
    await handleBrowserClose("c1", { tabId });
    expect(respond).toHaveBeenCalledWith({ id: "c1", success: true, data: { tabId, closed: true } });
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
