import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserPageTabs } from "./BrowserPageTabs";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";

vi.mock("@/hooks/useTabOperations", () => ({
  closeTabWithDirtyCheck: vi.fn(() => Promise.resolve(true)),
}));

function reset() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    lastActiveBrowserPageId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

function seedPages() {
  const a = useTabStore.getState().createBrowserPage("main", "https://a.example/", "A");
  const b = useTabStore.getState().createBrowserPage("main", "https://b.example/", "B");
  const pages = useTabStore.getState().tabs.main!.filter(isBrowserTab);
  return { a, b, pages };
}

beforeEach(() => {
  reset();
  vi.mocked(closeTabWithDirtyCheck).mockClear();
});

describe("BrowserPageTabs", () => {
  it("renders a tab per page plus the new-page button", () => {
    const { pages, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /new/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /B/ })).toHaveAttribute("aria-selected", "true");
  });

  it("activates a page on click", () => {
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    fireEvent.click(screen.getByRole("tab", { name: /A/ }));
    expect(useTabStore.getState().activeTabId.main).toBe(a);
  });

  it("activates a page on Enter but not when Enter bubbles from the close button", () => {
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    const aTab = screen.getByRole("tab", { name: /A/ });

    fireEvent.keyDown(within(aTab).getByRole("button"), { key: "Enter" });
    expect(useTabStore.getState().activeTabId.main).not.toBe(a);

    fireEvent.keyDown(aTab, { key: "Enter" });
    expect(useTabStore.getState().activeTabId.main).toBe(a);
  });

  it("moves focus with ArrowRight/Home/End (roving tablist)", () => {
    const { pages, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    const [aTab, bTab] = screen.getAllByRole("tab");
    aTab.focus();
    fireEvent.keyDown(aTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(bTab);
    fireEvent.keyDown(bTab, { key: "Home" });
    expect(document.activeElement).toBe(aTab);
  });

  it("closes a page via its close button", () => {
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    const aTab = screen.getByRole("tab", { name: /A/ });
    fireEvent.click(within(aTab).getByRole("button"));
    expect(closeTabWithDirtyCheck).toHaveBeenCalledWith("main", a);
  });

  it("closes a page via keyboard on its close button", async () => {
    const user = userEvent.setup();
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    const closeBtn = within(screen.getByRole("tab", { name: /A/ })).getByRole("button");
    closeBtn.focus();
    await user.keyboard("{Enter}");
    expect(closeTabWithDirtyCheck).toHaveBeenCalledWith("main", a);
  });

  it("creates and activates a fresh page from the new-page button", () => {
    const { pages, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    const tabs = useTabStore.getState().tabs.main!;
    expect(tabs.filter(isBrowserTab)).toHaveLength(3);
    expect(useTabStore.getState().activeTabId.main).toBe(tabs[tabs.length - 1].id);
  });
});
