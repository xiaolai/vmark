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
import { usePaneStore } from "@/stores/paneStore";
import { onTabActivated } from "@/stores/tabActivationBus";
import { isBrowserTab } from "@/stores/tabStoreTypes";
import { activateTabInFocusedPane } from "@/services/navigation/activateTabInFocusedPane";
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

// Audit 2026-09-03 #162 — the "+" button used to activate the new page TWICE: once
// inside `createBrowserPage`, which writes the alias and announces on the activation
// bus, and again through `activateTabInFocusedPane`. The second call was defended as
// the pane-aware activation a split view needs. Panes hold documents only
// (paneStore: "browser tabs overlay; panes hold documents"), so there is no pane
// state a browser activation can converge; the call re-wrote identical state and
// announced the same activation a second time — to the MRU, and to every other
// subscriber. Pinned here in the split scenario it was said to serve.
describe("new-page activation in a split view (#162)", () => {
  beforeEach(() => usePaneStore.getState().removeWindow("main"));

  /** Two documents side by side, the secondary pane focused, then the browser
   *  workspace opened over the split — the scenario the second call was for. */
  function openSplitThenBrowser() {
    const docA = useTabStore.getState().createTab("main", "/a.md");
    const docB = useTabStore.getState().createTab("main", "/b.md");
    useTabStore.getState().setActiveTab("main", docA);
    usePaneStore.getState().openSplit("main", docB); // primary A, secondary B, secondary focused
    const { pages, b } = seedPages();
    return { docA, docB, pages, b };
  }

  const newestTabId = () => {
    const tabs = useTabStore.getState().tabs.main!;
    return tabs[tabs.length - 1]!.id;
  };

  it("the store's own write activates the new page and announces it exactly once; the split is untouched", () => {
    const { docA, docB, pages, b } = openSplitThenBrowser();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    const seen = vi.fn();
    const off = onTabActivated(seen);
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    off();

    const created = newestTabId();
    expect(useTabStore.getState().activeTabId.main).toBe(created);
    expect(useTabStore.getState().lastActiveBrowserPageId.main).toBe(created);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith("main", created, "user");
    // Panes hold documents only — a browser activation has nothing to converge there.
    expect(usePaneStore.getState().getSplit("main")).toMatchObject({
      enabled: true,
      primaryTabId: docA,
      secondaryTabId: docB,
      focusedPane: "secondary",
    });
  });

  it("the activation the button no longer repeats would have changed nothing — only announced again", () => {
    const { pages, b } = openSplitThenBrowser();
    render(<BrowserPageTabs pages={pages} activePageId={b} windowLabel="main" />);
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    const created = newestTabId();

    const tabsBefore = useTabStore.getState().tabs;
    const aliasBefore = { ...useTabStore.getState().activeTabId };
    const lastPageBefore = { ...useTabStore.getState().lastActiveBrowserPageId };
    const panesBefore = usePaneStore.getState().byWindow;
    const seen = vi.fn();
    const off = onTabActivated(seen);
    activateTabInFocusedPane("main", created);
    off();

    expect(useTabStore.getState().tabs).toBe(tabsBefore);
    expect(useTabStore.getState().activeTabId).toEqual(aliasBefore);
    expect(useTabStore.getState().lastActiveBrowserPageId).toEqual(lastPageBefore);
    expect(usePaneStore.getState().byWindow).toBe(panesBefore);
    expect(seen).toHaveBeenCalledTimes(1); // the duplicate announcement the finding was about
  });
});
