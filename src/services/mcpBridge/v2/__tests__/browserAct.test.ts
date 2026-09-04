// @vitest-environment node
// WI-P4.2 — vmark.browser.act scroll/key (act-class). Extracted with the act
// handler into browserAct.ts (audit #9). The comprehensive click/type/ref +
// one-shot coverage lives in browser.test.ts (via the browser.ts re-export);
// this focuses on the new scroll/key operations.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { respond } from "@/services/mcpBridge/utils";
import { handleBrowserAct } from "@/services/mcpBridge/v2/browserAct";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";

const BLOG = "https://blog.example.com/";
function seed(): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
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

  // Round 3, #38 — validation runs BEFORE the attachment gate (the power tools'
  // ordering rule): a malformed act must fail on its own, never queue an attach
  // prompt the user is then asked to answer for nothing.
  it("refuses a malformed act on an unattached human tab without queueing an attach prompt", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
    const id = useTabStore.getState().createBrowserTab("main", BLOG, "Blog", "human");
    await handleBrowserAct("bad-human", { tabId: id, operation: "frobnicate" });
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false, error: expect.stringContaining("act supports") });
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
  });
});

// WI-NB1.3 — act responses carry page state, and failures name the next tool.
describe("act truthfulness in responses (WI-NB1.3)", () => {
  it("a successful act reports the tab's current url and generation", async () => {
    const id = seed();
    grant("click");
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    await handleBrowserAct("ok", { tabId: id, operation: "click", role: "button", name: "Publish" });
    const r = lastResponse() as { success: boolean; data: { url?: string; generation?: number } };
    expect(r.success).toBe(true);
    expect(r.data.url).toContain("blog.example.com");
    expect(r.data.generation).toBe(1);
  });

  it("reports the POST-act generation when the click navigated (store already updated)", async () => {
    const id = seed();
    grant("click");
    invoke.mockImplementation(() => {
      // The click triggers a navigation: the webview mirror updates before respond.
      useTabStore.getState().updateBrowserTab(id, { generation: 2, url: "https://blog.example.com/next" });
      return Promise.resolve(JSON.stringify({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    });
    await handleBrowserAct("nav", { tabId: id, operation: "click", role: "link", name: "Next" });
    const r = lastResponse() as { data: { url?: string; generation?: number } };
    expect(r.data.generation).toBe(2);
    expect(r.data.url).toContain("/next");
  });

  it("an obscured click fails with prose naming browser.style, plus the result and page state", async () => {
    const id = seed();
    grant("click");
    invoke.mockResolvedValue(
      JSON.stringify({
        found: true,
        clicked: false,
        reason: "obscured",
        by: "div.cmp-overlay",
        matchedTotal: 1,
        matchedVisible: 1,
      }),
    );
    await handleBrowserAct("blocked", { tabId: id, operation: "click", role: "button", name: "Accept" });
    const r = lastResponse() as { success: boolean; error?: string; data: Record<string, unknown> };
    expect(r.success).toBe(false);
    expect(r.error).toContain("div.cmp-overlay");
    expect(r.error).toContain("browser.style");
    expect(r.data.result).toMatchObject({ reason: "obscured" });
    expect(r.data.url).toContain("blog.example.com");
  });

  it("an all-hidden click failure surfaces the match counts in prose", async () => {
    const id = seed();
    grant("click");
    invoke.mockResolvedValue(
      JSON.stringify({ found: true, clicked: false, reason: "hidden", matchedTotal: 3, matchedVisible: 0 }),
    );
    await handleBrowserAct("hidden", { tabId: id, operation: "click", role: "button", name: "Continue" });
    const r = lastResponse() as { success: boolean; error?: string };
    expect(r.success).toBe(false);
    expect(r.error).toContain("3");
    expect(r.error).toMatch(/hidden|rendered/);
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
