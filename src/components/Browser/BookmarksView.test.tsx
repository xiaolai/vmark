// WI-S3.2 / WI-S3.3 — BookmarksView: see them, open them, remove them.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({ submitOmnibox: vi.fn() }));
vi.mock("@/services/browser/browserNavigation", () => nav);
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
  useIsDocumentWindow: () => true,
}));

import { BookmarksView } from "./BookmarksView";
import { useBookmarkStore } from "@/stores/bookmarkStore";
import { useTabStore } from "@/stores/tabStore";

beforeEach(() => {
  cleanup();
  nav.submitOmnibox.mockClear();
  localStorage.clear();
  useBookmarkStore.setState({ bookmarks: [] });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
});

describe("BookmarksView", () => {
  it("says so plainly when there are none", () => {
    render(<BookmarksView />);
    expect(screen.getByText(/no bookmarks/i)).toBeInTheDocument();
  });

  it("lists bookmarks with their titles", () => {
    useBookmarkStore.getState().add("https://a.com/x", "Alpha");
    render(<BookmarksView />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  // WI-S3.3 — opening a bookmark from a DOCUMENT tab must create a browser tab; there is
  // no browser to navigate.
  it("creates a browser tab when opened with no browser active", async () => {
    useBookmarkStore.getState().add("https://a.com/x", "Alpha");
    render(<BookmarksView />);
    const row = screen.getByRole("listitem");
    await userEvent.click(within(row).getAllByRole("button")[0]); // the open button

    const tabs = useTabStore.getState().tabs["main"] ?? [];
    const browserTabs = tabs.filter((t) => t.kind === "browser");
    expect(browserTabs).toHaveLength(1);
    expect(browserTabs[0]).toMatchObject({ url: "https://a.com/x" });
  });

  it("navigates the existing browser tab rather than opening a second one", async () => {
    const tabId = useTabStore.getState().createBrowserTab("main", "https://start.com/", "S");
    useTabStore.getState().setActiveTab("main", tabId);
    useBookmarkStore.getState().add("https://a.com/x", "Alpha");

    render(<BookmarksView />);
    const row = screen.getByRole("listitem");
    await userEvent.click(within(row).getAllByRole("button")[0]); // the open button

    expect(nav.submitOmnibox).toHaveBeenCalledWith(tabId, "https://a.com/x");
    const browserTabs = (useTabStore.getState().tabs["main"] ?? []).filter(
      (t) => t.kind === "browser",
    );
    expect(browserTabs).toHaveLength(1);
  });

  it("removes a bookmark", async () => {
    useBookmarkStore.getState().add("https://a.com/x", "Alpha");
    render(<BookmarksView />);
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(useBookmarkStore.getState().bookmarks).toHaveLength(0);
  });
});
