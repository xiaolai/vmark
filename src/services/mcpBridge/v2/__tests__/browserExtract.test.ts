// WI-NB4.1 — vmark.browser.extract: reader-mode extraction of the current page.
// jsdom environment (NOT node): the reader parses captured HTML with DOMParser
// in the VMark webview, which is exactly what this harness exercises.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { respond } from "@/services/mcpBridge/utils";
import { handleBrowserExtract } from "@/services/mcpBridge/v2/browserExtract";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { __resetSiteRegistry } from "@/lib/sites/registry";
import { __resetBuiltinSites } from "@/lib/sites/builtins";

const ARTICLE_URL = "https://blog.example.com/post/1";
const PAGE = `<html><head><title>My Post — Blog</title></head><body>
  <nav>Home About</nav>
  <article><h1>My Post</h1><p>${"Real content sentence. ".repeat(20)}</p></article>
  <footer>© Blog</footer></body></html>`;

function seed(url = ARTICLE_URL): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  const id = useTabStore.getState().createBrowserTab("main", url, "Blog", "ai-sandbox");
  useTabStore.getState().updateBrowserTab(id, { generation: 1 });
  return id;
}
function lastResponse() {
  const c = vi.mocked(respond).mock.calls;
  return c[c.length - 1][0] as { success: boolean; error?: string; data?: Record<string, unknown> };
}

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  __resetSiteRegistry();
  __resetBuiltinSites();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("handleBrowserExtract", () => {
  it("captures the page via a read-class eval and returns reader-mode markdown", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ html: PAGE, truncated: false }));
    await handleBrowserExtract("x1", { tabId: id });
    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ tabId: id, operation: "read", generation: 1 }),
    );
    const r = lastResponse();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ truncated: false });
    expect(r.data?.title).toBe("My Post");
    expect(String(r.data?.markdown)).toContain("Real content sentence.");
    expect(String(r.data?.markdown)).not.toContain("© Blog");
    expect(typeof r.data?.textLength).toBe("number");
  });

  it("routes a wikipedia article through the wikipedia site reader", async () => {
    const id = seed("https://en.wikipedia.org/wiki/Markdown");
    invoke.mockResolvedValue(
      JSON.stringify({
        html: `<html><head><title>Markdown - Wikipedia</title></head><body><div id="content">
          <h1 id="firstHeading">Markdown</h1>
          <div class="hatnote">This article is about the markup language.</div>
          <p>${"Markup prose here. ".repeat(15)}</p></div></body></html>`,
        truncated: false,
      }),
    );
    await handleBrowserExtract("x2", { tabId: id });
    const r = lastResponse();
    expect(r.success).toBe(true);
    expect(String(r.data?.markdown)).not.toContain("This article is about");
  });

  it("propagates the truncation flag", async () => {
    const id = seed();
    invoke.mockResolvedValue(JSON.stringify({ html: PAGE, truncated: true }));
    await handleBrowserExtract("x3", { tabId: id });
    expect(lastResponse().data).toMatchObject({ truncated: true });
  });

  it("fails closed when the browser is disabled", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    seed();
    await handleBrowserExtract("x-off", {});
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false, error: "BROWSER_DISABLED" });
  });

  it("reports a malformed eval payload as a failure, not a crash", async () => {
    const id = seed();
    invoke.mockResolvedValue("<timeout>");
    await handleBrowserExtract("x4", { tabId: id });
    expect(lastResponse().success).toBe(false);
  });
});
