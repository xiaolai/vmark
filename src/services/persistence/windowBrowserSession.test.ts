// @vitest-environment node
// WI-8.2 — window-scoped browser-session persistence: restore-human pages
// round-trip per window; AI pages are transient; restore is once-per-window,
// never steals activation, and never duplicates open URLs.
import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import {
  loadWindowBrowserSession,
  restoreWindowBrowserSession,
  resetWindowBrowserSessionRestores,
  saveWindowBrowserSession,
} from "./windowBrowserSession";

const W = "main";

beforeEach(() => {
  localStorage.clear();
  resetWindowBrowserSessionRestores();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
});

describe("windowBrowserSession (WI-8.2)", () => {
  it("round-trips restore-human pages for the window", () => {
    useTabStore.getState().createBrowserPage(W, "https://human.example/", "Human", "human");
    saveWindowBrowserSession(W, useTabStore.getState().getTabsByWindow(W));

    const records = loadWindowBrowserSession(W);
    expect(records).toHaveLength(1);
    expect(records[0].url).toContain("human.example");
  });

  it("excludes AI pages (transient by contract)", () => {
    useTabStore.getState().createBrowserPage(W, "https://human.example/", "Human", "human");
    useTabStore.getState().createBrowserPage(W, "https://ai.example/", "AI", "ai-sandbox");
    saveWindowBrowserSession(W, useTabStore.getState().getTabsByWindow(W));

    const records = loadWindowBrowserSession(W);
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("ai.example");
  });

  it("rejects malformed URLs at load (validation shared with sessionTabs)", () => {
    localStorage.setItem(
      "vmark-window-browser-session:main",
      JSON.stringify({
        version: 1,
        tabs: [
          { kind: "browser", url: "javascript:alert(1)", title: "evil" },
          { kind: "browser", url: "https://ok.example/", title: "ok" },
        ],
      }),
    );

    const records = loadWindowBrowserSession(W);
    expect(records).toHaveLength(1);
    expect(records[0].url).toContain("ok.example");
  });

  it("restores once per window, without stealing activation or duplicating", () => {
    const docId = useTabStore.getState().createTab(W, "/doc.md");
    useTabStore.getState().createBrowserPage(W, "https://already.example/", "Open", "human");
    useTabStore.getState().createBrowserPage(W, "https://gone.example/", "Gone", "human");
    saveWindowBrowserSession(W, useTabStore.getState().getTabsByWindow(W));

    // Simulate a fresh window: only the doc and the still-open page exist.
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
    useTabStore.getState().createTab(W, "/doc.md");
    useTabStore.getState().createBrowserPage(W, "https://already.example/", "Open", "human");
    const newDocId = useTabStore.getState().getTabsByWindow(W)[0].id;
    useTabStore.getState().setActiveTab(W, newDocId);

    const restored = restoreWindowBrowserSession(W);
    expect(restored).toBe(1); // only gone.example — already.example is open
    expect(useTabStore.getState().activeTabId[W]).toBe(newDocId);

    // Second call: once-per-window guard.
    expect(restoreWindowBrowserSession(W)).toBe(0);
    void docId;
  });

  it("restores into a window with NO active tab (prev-null branch)", () => {
    useTabStore.getState().createBrowserPage(W, "https://solo.example/", "Solo", "human");
    saveWindowBrowserSession(W, useTabStore.getState().getTabsByWindow(W));
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });

    const restored = restoreWindowBrowserSession(W);
    expect(restored).toBe(1);
    // No previous active existed — nothing restored as "active".
  });

  it("loose-only save with zero human pages clears the key", () => {
    useTabStore.getState().createBrowserPage(W, "https://x.example/", "X", "ai-shared");
    saveWindowBrowserSession(W, useTabStore.getState().getTabsByWindow(W));
    expect(localStorage.getItem("vmark-window-browser-session:main")).toBeNull();
  });
});
