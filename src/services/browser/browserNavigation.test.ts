// WI-S1.2 — browserNavigation: stateless nav actions shared by the omnibox + surface
import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useTabStore } from "@/stores/tabStore";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import {
  submitOmnibox,
  reloadBrowser,
  backBrowser,
  forwardBrowser,
  stopBrowser,
} from "./browserNavigation";

const WINDOW = "main";

function seedBrowserTab(url: string): string {
  const tabId = useTabStore.getState().createBrowserTab(WINDOW, url);
  useBrowserUiStore.getState().ensureEntry(tabId, url);
  useBrowserUiStore.getState().setLoading(tabId, false);
  return tabId;
}

beforeEach(() => {
  useTabStore.getState().removeWindow(WINDOW);
  useBrowserUiStore.setState({ entries: {} });
  invokeMock.mockClear();
});

describe("submitOmnibox", () => {
  it("navigates to a resolved URL and shows it in the omnibox", () => {
    const tabId = seedBrowserTab("https://start.com/");
    submitOmnibox(tabId, "example.com");

    expect(invokeMock).toHaveBeenCalledWith("browser_navigate", {
      tabId,
      url: "https://example.com/",
    });
    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({
      urlInput: "https://example.com/",
      loading: true,
    });
  });

  // Codex review (v3, D1#5): the committed url is what the webview ACTUALLY has.
  // Writing it at request time made a rejected navigation leave the tab — and the
  // driver's origin gate, which reads the committed url — pointing at a page that
  // never loaded. Only `didCommitNavigation` may advance it.
  it("does NOT advance the tab's committed url before the navigation commits", () => {
    const tabId = seedBrowserTab("https://start.com/");
    submitOmnibox(tabId, "example.com");
    const tab = useTabStore.getState().findTabById(tabId);
    expect(tab && "url" in tab ? tab.url : null).toBe("https://start.com/");
  });

  it("turns a search phrase into a search navigation", () => {
    const tabId = seedBrowserTab("https://start.com/");
    submitOmnibox(tabId, "hello world");
    expect(invokeMock).toHaveBeenCalledWith("browser_navigate", {
      tabId,
      url: "https://duckduckgo.com/?q=hello%20world",
    });
  });

  it("ignores blank input (no navigation)", () => {
    const tabId = seedBrowserTab("https://start.com/");
    submitOmnibox(tabId, "   ");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("reloadBrowser", () => {
  it("reloads the tab's current committed (canonical) url", () => {
    // The committed BrowserTab.url is always canonical (fragment-free) — the
    // store canonicalizes on create/update — so reload targets exactly it.
    const tabId = seedBrowserTab("https://start.com/page");
    reloadBrowser(tabId);
    expect(invokeMock).toHaveBeenCalledWith("browser_navigate", {
      tabId,
      url: "https://start.com/page",
    });
  });
});

describe("back / forward / stop", () => {
  it("invokes the matching native command", () => {
    const tabId = seedBrowserTab("https://start.com/");
    backBrowser(tabId);
    forwardBrowser(tabId);
    stopBrowser(tabId);
    expect(invokeMock).toHaveBeenCalledWith("browser_back", { tabId });
    expect(invokeMock).toHaveBeenCalledWith("browser_forward", { tabId });
    expect(invokeMock).toHaveBeenCalledWith("browser_stop", { tabId });
  });
});
