// WI-1.1 — browser tab support in tabStore: create/dedupe/coexist/restore/update
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "../tabStore";
import { isBrowserTab, isDocumentTab } from "../tabStoreTypes";
import { __resetRegistry } from "@/lib/formats/registry";
import { registerMarkdownFormat } from "@/lib/formats/adapters/markdown";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const W = "main";

function resetTabStore() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    lastActiveBrowserPageId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

beforeEach(() => {
  __resetRegistry();
  registerMarkdownFormat();
  resetTabStore();
});

describe("createBrowserTab", () => {
  it("creates a browser tab with kind, canonical url, title, and makes it active", () => {
    const id = useTabStore.getState().createBrowserTab(W, "https://example.com", "Example");
    const tab = useTabStore.getState().findTabById(id);
    expect(tab).not.toBeNull();
    expect(tab!.kind).toBe("browser");
    if (isBrowserTab(tab!)) {
      expect(tab.url).toBe("https://example.com/"); // canonicalized
      expect(tab.title).toBe("Example");
      expect(tab.isPinned).toBe(false);
    }
    expect(useTabStore.getState().activeTabId[W]).toBe(id);
  });

  it("defaults the title to the url when omitted", () => {
    const id = useTabStore.getState().createBrowserTab(W, "https://example.com/x");
    const tab = useTabStore.getState().findTabById(id);
    if (isBrowserTab(tab!)) expect(tab.title).toBe("https://example.com/x");
  });

  it("dedupes by canonicalized url within a window (activates existing)", () => {
    const first = useTabStore.getState().createBrowserTab(W, "https://example.com/a");
    // different port spelling + fragment — same canonical url
    const second = useTabStore.getState().createBrowserTab(W, "https://example.com:443/a#top");
    expect(second).toBe(first);
    expect(useTabStore.getState().getTabsByWindow(W)).toHaveLength(1);
    expect(useTabStore.getState().activeTabId[W]).toBe(first);
  });

  it("does not dedupe distinct urls", () => {
    useTabStore.getState().createBrowserTab(W, "https://example.com/a");
    useTabStore.getState().createBrowserTab(W, "https://example.com/b");
    expect(useTabStore.getState().getTabsByWindow(W)).toHaveLength(2);
  });

  it("keeps a non-canonicalizable url as-is (still creates a tab)", () => {
    const id = useTabStore.getState().createBrowserTab(W, "about:blank");
    const tab = useTabStore.getState().findTabById(id);
    expect(tab).not.toBeNull();
    if (isBrowserTab(tab!)) expect(tab.url).toBe("about:blank");
  });

  it("creates a fresh page without URL deduplication", () => {
    const first = useTabStore.getState().createBrowserPage(W, "https://example.com/");
    const second = useTabStore.getState().createBrowserPage(W, "https://example.com/");

    expect(second).not.toBe(first);
    expect(useTabStore.getState().getTabsByWindow(W)).toHaveLength(2);
    expect(useTabStore.getState().activeTabId[W]).toBe(second);
  });
});

// Security-sensitive: an AI-driven page must never inherit the human
// "restore-human" persist policy (it would silently survive restarts). The
// persistPolicy is derived from automationMode, so both creation paths are
// guarded here.
describe("browser tab provenance (automationMode → persistPolicy)", () => {
  it("defaults to human / restore-human when no mode is given", () => {
    const tab = useTabStore.getState().findTabById(
      useTabStore.getState().createBrowserTab(W, "https://example.com/"),
    );
    if (isBrowserTab(tab!)) {
      expect(tab.automationMode).toBe("human");
      expect(tab.persistPolicy).toBe("restore-human");
    }
  });

  it("createBrowserTab with ai-sandbox derives transient-ai", () => {
    const tab = useTabStore.getState().findTabById(
      useTabStore.getState().createBrowserTab(W, "https://ai.example/", "AI", "ai-sandbox"),
    );
    if (isBrowserTab(tab!)) {
      expect(tab.automationMode).toBe("ai-sandbox");
      expect(tab.persistPolicy).toBe("transient-ai");
    }
  });

  it("createBrowserPage with ai-shared derives transient-ai", () => {
    const tab = useTabStore.getState().findTabById(
      useTabStore.getState().createBrowserPage(W, "https://ai.example/", "AI", "ai-shared"),
    );
    if (isBrowserTab(tab!)) {
      expect(tab.automationMode).toBe("ai-shared");
      expect(tab.persistPolicy).toBe("transient-ai");
    }
  });

  it("createBrowserPage defaults to human / restore-human", () => {
    const tab = useTabStore.getState().findTabById(
      useTabStore.getState().createBrowserPage(W, "https://example.com/"),
    );
    if (isBrowserTab(tab!)) {
      expect(tab.automationMode).toBe("human");
      expect(tab.persistPolicy).toBe("restore-human");
    }
  });
});

describe("lastActiveBrowserPageId (reopen memory)", () => {
  it("records the created page and updates on activation", () => {
    const a = useTabStore.getState().createBrowserPage(W, "https://a.example/");
    expect(useTabStore.getState().lastActiveBrowserPageId[W]).toBe(a);
    const b = useTabStore.getState().createBrowserPage(W, "https://b.example/");
    expect(useTabStore.getState().lastActiveBrowserPageId[W]).toBe(b);

    // Re-activating an earlier page updates the memory.
    useTabStore.getState().setActiveTab(W, a);
    expect(useTabStore.getState().lastActiveBrowserPageId[W]).toBe(a);
  });

  it("is not changed when activating a non-browser tab", () => {
    const a = useTabStore.getState().createBrowserPage(W, "https://a.example/");
    useTabStore.getState().setActiveTab(W, null);
    expect(useTabStore.getState().lastActiveBrowserPageId[W]).toBe(a);
  });

  it("tracks the browser successor when the active page is closed", () => {
    const a = useTabStore.getState().createBrowserPage(W, "https://a.example/");
    const b = useTabStore.getState().createBrowserPage(W, "https://b.example/");
    const c = useTabStore.getState().createBrowserPage(W, "https://c.example/");
    useTabStore.getState().setActiveTab(W, b); // active middle page

    useTabStore.getState().closeTab(W, b);
    const successor = useTabStore.getState().activeTabId[W];

    expect(successor).not.toBe(b);
    expect([a, c]).toContain(successor); // a browser page succeeded it
    // Memory follows the successor, not the closed page — so reopening returns to it.
    expect(useTabStore.getState().lastActiveBrowserPageId[W]).toBe(successor);
  });
});

describe("browser + document tabs coexist", () => {
  it("document tabs are kind:document; browser tabs excluded from path queries", () => {
    const doc = useTabStore.getState().createTab(W, "/a.md");
    const browser = useTabStore.getState().createBrowserTab(W, "https://example.com/");
    const docTab = useTabStore.getState().findTabById(doc);
    expect(docTab!.kind).toBe("document");
    if (isDocumentTab(docTab!)) expect(docTab.filePath).toBe("/a.md");

    // getAllOpenFilePaths ignores browser tabs
    expect(useTabStore.getState().getAllOpenFilePaths()).toEqual(["/a.md"]);
    // findTabByPath never returns a browser tab
    expect(useTabStore.getState().findTabByPath(W, "https://example.com/")).toBeNull();
    expect(useTabStore.getState().getTabsByWindow(W)).toHaveLength(2);
    expect(browser).not.toBe(doc);
  });

  it("shared lifecycle (close, reorder, pin) works on browser tabs", () => {
    const a = useTabStore.getState().createBrowserTab(W, "https://a.example/");
    const b = useTabStore.getState().createBrowserTab(W, "https://b.example/");
    // pin b → moves left
    useTabStore.getState().togglePin(W, b);
    expect(useTabStore.getState().getTabsByWindow(W).map((t) => t.id)).toEqual([b, a]);
    // close a
    useTabStore.getState().closeTab(W, a);
    expect(useTabStore.getState().getTabsByWindow(W).map((t) => t.id)).toEqual([b]);
    // reopen
    const reopened = useTabStore.getState().reopenClosedTab(W);
    expect(reopened?.id).toBe(a);
  });

  it("createTab dedup is not confused by a same-window browser tab", () => {
    useTabStore.getState().createBrowserTab(W, "https://example.com/");
    const doc1 = useTabStore.getState().createTab(W, "/a.md");
    const doc2 = useTabStore.getState().createTab(W, "/a.md");
    expect(doc2).toBe(doc1); // document dedup still works
    expect(useTabStore.getState().getTabsByWindow(W)).toHaveLength(2);
  });
});

describe("updateBrowserTab", () => {
  it("updates url/title/scrollY of a browser tab", () => {
    const id = useTabStore.getState().createBrowserTab(W, "https://example.com/");
    useTabStore.getState().updateBrowserTab(id, {
      url: "https://example.com/next",
      title: "Next",
      scrollY: 120,
    });
    const tab = useTabStore.getState().findTabById(id);
    if (isBrowserTab(tab!)) {
      expect(tab.url).toBe("https://example.com/next");
      expect(tab.title).toBe("Next");
      expect(tab.scrollY).toBe(120);
    }
  });

  it("is a no-op on a document tab (never converts kind)", () => {
    const doc = useTabStore.getState().createTab(W, "/a.md");
    useTabStore.getState().updateBrowserTab(doc, { url: "https://evil.example/" });
    const tab = useTabStore.getState().findTabById(doc);
    expect(tab!.kind).toBe("document");
    expect("url" in tab!).toBe(false);
  });

  it("is a no-op for an unknown tab id", () => {
    expect(() =>
      useTabStore.getState().updateBrowserTab("missing", { title: "x" }),
    ).not.toThrow();
  });
});
