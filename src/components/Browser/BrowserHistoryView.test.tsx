// WI-S2.2 — BrowserHistoryView: this window's browsing, newest first.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({ submitOmnibox: vi.fn() }));
vi.mock("@/services/browser/browserNavigation", () => nav);
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
  useIsDocumentWindow: () => true,
}));

import { BrowserHistoryView } from "./BrowserHistoryView";
import { useBrowserHistoryStore } from "@/stores/browserHistoryStore";
import { useTabStore } from "@/stores/tabStore";

beforeEach(() => {
  cleanup();
  nav.submitOmnibox.mockClear();
  useBrowserHistoryStore.setState({ byWindow: {} });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
});

describe("BrowserHistoryView", () => {
  it("says so plainly when nothing has been visited", () => {
    render(<BrowserHistoryView />);
    expect(screen.getByText(/nothing visited/i)).toBeInTheDocument();
  });

  it("lists this window's history, newest first, with titles where known", () => {
    const s = useBrowserHistoryStore.getState();
    s.record("main", { tabId: "t1", url: "https://a.com/", transitionKind: "typed" });
    s.setTitle("main", "t1", "https://a.com/", "Alpha");
    s.record("main", { tabId: "t1", url: "https://b.com/", transitionKind: "link" });

    render(<BrowserHistoryView />);
    // Scope to the list — the header's Clear button is a button too.
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("https://b.com/"); // newest first
    expect(items[1]).toHaveTextContent("Alpha");
  });

  it("does not show another window's browsing", () => {
    useBrowserHistoryStore
      .getState()
      .record("doc-2", { tabId: "t9", url: "https://other.com/", transitionKind: "typed" });
    render(<BrowserHistoryView />);
    expect(screen.queryByText(/other\.com/)).toBeNull();
  });

  it("clicking an entry navigates the active browser tab to it", async () => {
    const tabId = useTabStore.getState().createBrowserTab("main", "https://a.com/", "A");
    useTabStore.getState().setActiveTab("main", tabId);
    useBrowserHistoryStore
      .getState()
      .record("main", { tabId, url: "https://b.com/", transitionKind: "link" });

    render(<BrowserHistoryView />);
    await userEvent.click(screen.getByRole("button", { name: /b\.com/ }));
    expect(nav.submitOmnibox).toHaveBeenCalledWith(tabId, "https://b.com/");
  });

  it("clears the window's history", async () => {
    useBrowserHistoryStore
      .getState()
      .record("main", { tabId: "t1", url: "https://a.com/", transitionKind: "typed" });
    render(<BrowserHistoryView />);
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(useBrowserHistoryStore.getState().byWindow["main"]).toHaveLength(0);
  });
});
