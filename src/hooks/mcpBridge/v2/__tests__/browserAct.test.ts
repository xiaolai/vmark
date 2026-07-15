// WI-P4.2 — vmark.browser.act scroll/key (act-class). Extracted with the act
// handler into browserAct.ts (audit #9). The comprehensive click/type/ref +
// one-shot coverage lives in browser.test.ts (via the browser.ts re-export);
// this focuses on the new scroll/key operations.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { respond } from "../../utils";
import { handleBrowserAct } from "../browserAct";
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
function grant(...ops: string[]) {
  useBrowserApprovalStore.getState().grant("https://blog.example.com", ops);
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

describe("act smoke (via browserAct.ts directly)", () => {
  it("clicks by role/name on a granted origin", async () => {
    const id = seed();
    grant("click");
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true }));
    await handleBrowserAct("c", { tabId: id, operation: "click", role: "button", name: "Publish" });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkClick"));
    expect(lastResponse()).toMatchObject({ success: true });
  });

  it("refuses an operation outside click/type/scroll/key", async () => {
    const id = seed();
    await handleBrowserAct("bad", { tabId: id, operation: "frobnicate" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });
});

describe("act scroll (WI-P4.2)", () => {
  it("scrolls to a ref on a granted origin", async () => {
    const id = seed();
    grant("scroll");
    invoke.mockResolvedValue(JSON.stringify({ found: true, scrolled: true }));
    await handleBrowserAct("s1", { tabId: id, operation: "scroll", ref: "e4" });
    expect(evalCall()).toMatchObject({ operation: "scroll", generation: 1 });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkScroll"));
    expect(lastResponse()).toMatchObject({ success: true, data: { result: { scrolled: true } } });
  });

  it("scrolls by a pixel delta on a granted origin", async () => {
    const id = seed();
    grant("scroll");
    invoke.mockResolvedValue(JSON.stringify({ scrolled: true }));
    await handleBrowserAct("s2", { tabId: id, operation: "scroll", dy: 500 });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkScroll"));
    expect(lastResponse()).toMatchObject({ success: true });
  });

  it("refuses a ref scroll on an un-granted origin", async () => {
    const id = seed();
    await handleBrowserAct("s3", { tabId: id, operation: "scroll", ref: "e4" });
    expect(invoke).not.toHaveBeenCalled();
    expect(String(lastResponse().error)).toContain("standing grant");
  });

  it("requests approval for a delta scroll on an un-granted origin", async () => {
    const id = seed();
    await handleBrowserAct("s4", { tabId: id, operation: "scroll", dy: 300 });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "scroll" });
  });

  it("refuses both ref and dy, and refuses neither", async () => {
    const id = seed();
    grant("scroll");
    await handleBrowserAct("s5", { tabId: id, operation: "scroll", ref: "e4", dy: 10 });
    expect(lastResponse()).toMatchObject({ success: false });
    await handleBrowserAct("s6", { tabId: id, operation: "scroll" });
    expect(lastResponse()).toMatchObject({ success: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("act key (WI-P4.2)", () => {
  it("presses a key against a ref on a granted origin", async () => {
    const id = seed();
    grant("key");
    invoke.mockResolvedValue(JSON.stringify({ found: true, dispatched: true }));
    await handleBrowserAct("k1", { tabId: id, operation: "key", key: "Enter", ref: "e2" });
    expect(evalCall()).toMatchObject({ operation: "key", generation: 1 });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkKey"));
    expect(lastResponse()).toMatchObject({ success: true, data: { result: { dispatched: true } } });
  });

  it("presses a key on the active element (no ref) on a granted origin", async () => {
    const id = seed();
    grant("key");
    invoke.mockResolvedValue(JSON.stringify({ found: true, dispatched: true }));
    await handleBrowserAct("k2", { tabId: id, operation: "key", key: "Escape" });
    expect(evalCall()?.script).toEqual(expect.stringContaining("__vmarkKey"));
    expect(lastResponse()).toMatchObject({ success: true });
  });

  it("requests approval for a key on an un-granted origin (no ref)", async () => {
    const id = seed();
    await handleBrowserAct("k3", { tabId: id, operation: "key", key: "Enter" });
    expect(invoke).not.toHaveBeenCalled();
    expect((lastResponse().data as { needsApproval?: boolean }).needsApproval).toBe(true);
  });

  it("refuses a key act with no key name", async () => {
    const id = seed();
    grant("key");
    await handleBrowserAct("k4", { tabId: id, operation: "key" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });
});
