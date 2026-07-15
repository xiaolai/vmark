// WI-P7.1 — console read handler (read-class). Reads the shared DOM ring buffer via
// the isolated-world eval; captured output is untrusted (page-controlled).
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { respond } from "../../utils";
import { handleBrowserConsole } from "../browserConsole";
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
function evalCall() {
  return invoke.mock.calls.find((c) => c[0] === "browser_eval")?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("handleBrowserConsole (read-class)", () => {
  it("reads the console buffer via an isolated-world eval and returns the entries", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ entries: [{ level: "error", text: "boom" }] }));
    await handleBrowserConsole("c1", { tabId: id });
    expect(evalCall()).toMatchObject({ operation: "read", generation: 1 });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmark_console_buffer"));
    expect(lastResponse()).toMatchObject({ success: true, data: { entries: [{ level: "error", text: "boom" }] } });
  });

  it("passes clear:true through to the read script", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ entries: [] }));
    await handleBrowserConsole("c2", { tabId: id, clear: true });
    expect(evalCall()?.script).toEqual(expect.stringContaining('textContent="[]"'));
  });

  it("does not clear by default", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ entries: [] }));
    await handleBrowserConsole("c3", { tabId: id });
    expect(evalCall()?.script).not.toEqual(expect.stringContaining('textContent="[]"'));
  });
});
