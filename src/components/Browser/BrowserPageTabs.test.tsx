// Audit 2026-09-03 round 3, #163 — the page tab is its own role="tab" element and its
// close control is a SIBLING inside a non-interactive wrapper, never a descendant.
// A focusable control nested inside a role="tab" broke the APG roving model twice
// over: the tab's accessible name absorbed the close button, and every inactive
// page's close button stayed in the normal Tab sequence while its tab did not.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserPageTabs } from "./BrowserPageTabs";
import { useTabStore } from "@/stores/tabStore";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { closeTabWithDirtyCheck } from "@/services/tabs/tabOperations";

vi.mock("@/services/tabs/tabOperations", () => ({
  closeTabWithDirtyCheck: vi.fn(() => Promise.resolve(true)),
}));

function reset() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    lastActiveBrowserPageId: {},
    untitledCounter: 0,
  });
}

function seedPages() {
  const a = useTabStore.getState().createBrowserPage("main", "https://a.example/", "A");
  const b = useTabStore.getState().createBrowserPage("main", "https://b.example/", "B");
  const pages = useTabStore.getState().tabs.main!.filter(isBrowserTab);
  return { a, b, pages };
}

/** The close control for the page titled `title` — found by NAME, because it is
 *  no longer inside the tab and must not be. */
const closeButton = (title: string) => screen.getByRole("button", { name: `Close ${title}` });

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

  it("the tab's close control is a sibling, not a descendant", () => {
    const { pages, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    const aTab = screen.getByRole("tab", { name: /A/ });
    // A div like the status-bar pill, not a <button>: the bespoke-button budget
    // counts every non-canonical class on a literal <button>.
    expect(aTab.tagName).toBe("DIV");
    // No interactive descendant: the tab's accessible name is its own.
    expect(within(aTab).queryByRole("button")).toBeNull();
    expect(aTab).toHaveAccessibleName("A");
    const close = closeButton("A");
    expect(aTab.contains(close)).toBe(false);
    // Both live in ONE non-interactive wrapper.
    expect(close.parentElement).toBe(aTab.parentElement);
    expect(aTab.parentElement).not.toHaveAttribute("role");
    expect(aTab.parentElement).not.toHaveAttribute("tabindex");
  });

  it("roving tabindex: the active tab is the strip's tab stop; inactive tabs are -1", () => {
    const { pages, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    expect(screen.getByRole("tab", { name: /B/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /A/ })).toHaveAttribute("tabindex", "-1");
  });

  it("only the current page's close button is in the Tab sequence", () => {
    // The roving model has ONE stop per strip. An inactive page's close button in
    // the normal Tab order added a stop per page — for pages nobody was looking at.
    const { pages, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    expect(closeButton("B")).toHaveAttribute("tabindex", "0");
    expect(closeButton("A")).toHaveAttribute("tabindex", "-1");
  });

  it("activates a page on click", () => {
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    fireEvent.click(screen.getByRole("tab", { name: /A/ }));
    expect(useTabStore.getState().activeTabId.main).toBe(a);
  });

  it("activates a page on Enter and on Space", () => {
    const { pages, a, b } = seedPages();
    const { rerender } = render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /A/ }), { key: "Enter" });
    expect(useTabStore.getState().activeTabId.main).toBe(a);

    rerender(<BrowserPageTabs pages={pages} activePageId={a} windowLabel="main" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /B/ }), { key: " " });
    expect(useTabStore.getState().activeTabId.main).toBe(b);
  });

  it("Enter on a close button closes that page and does not activate it", async () => {
    const user = userEvent.setup();
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    closeButton("A").focus();
    await user.keyboard("{Enter}");
    expect(closeTabWithDirtyCheck).toHaveBeenCalledWith("main", a);
    expect(useTabStore.getState().activeTabId.main).toBe(b);
  });

  it("ignores keys that are neither activation nor navigation", () => {
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    const aTab = screen.getByRole("tab", { name: /A/ });
    aTab.focus();
    fireEvent.keyDown(aTab, { key: "x" });
    expect(useTabStore.getState().activeTabId.main).toBe(b); // unchanged — no activation
    expect(a).not.toBe(b);
  });

  it("moves focus with ArrowRight/ArrowLeft/Home/End (roving tablist), skipping close buttons", () => {
    const { pages, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    const [aTab, bTab] = screen.getAllByRole("tab");
    aTab.focus();
    fireEvent.keyDown(aTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(bTab);
    fireEvent.keyDown(bTab, { key: "ArrowRight" }); // wraps — never lands on a close button
    expect(document.activeElement).toBe(aTab);
    fireEvent.keyDown(aTab, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(bTab);
    fireEvent.keyDown(bTab, { key: "Home" });
    expect(document.activeElement).toBe(aTab);
    fireEvent.keyDown(aTab, { key: "End" });
    expect(document.activeElement).toBe(bTab);
  });

  it("closes a page via its close button", () => {
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    fireEvent.click(closeButton("A"));
    expect(closeTabWithDirtyCheck).toHaveBeenCalledWith("main", a);
    // A click on the close control is not a click on the tab.
    expect(useTabStore.getState().activeTabId.main).toBe(b);
  });

  it("closes a page via keyboard on its close button", async () => {
    const user = userEvent.setup();
    const { pages, a, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    closeButton("A").focus();
    await user.keyboard("{Enter}");
    expect(closeTabWithDirtyCheck).toHaveBeenCalledWith("main", a);
  });

  it("a rejected close does not crash the strip", async () => {
    vi.mocked(closeTabWithDirtyCheck).mockRejectedValueOnce(new Error("dirty check failed"));
    const { pages, b } = seedPages();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    fireEvent.click(closeButton("A"));
    await Promise.resolve();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
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
