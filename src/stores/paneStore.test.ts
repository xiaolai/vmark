import { describe, it, expect, beforeEach } from "vitest";
import { usePaneStore, DEFAULT_SPLIT, MIN_PANE_FRACTION, MAX_PANE_FRACTION } from "./paneStore";
import { useTabStore } from "./tabStore";

const W = "main";

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useTabStore.setState({ activeTabId: { [W]: "primary-tab" } } as never);
});

function activeTab() {
  return useTabStore.getState().activeTabId[W];
}

describe("paneStore (#1081)", () => {
  it("defaults to a disabled single-pane split for unknown windows", () => {
    expect(usePaneStore.getState().getSplit(W)).toEqual(DEFAULT_SPLIT);
  });

  it("openSplit captures the current tab as primary, sets secondary, focuses it, and aliases activeTabId", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(true);
    expect(split.primaryTabId).toBe("primary-tab"); // captured from activeTabId
    expect(split.secondaryTabId).toBe("secondary-tab");
    expect(split.focusedPane).toBe("secondary");
    // activeTabId mirrors the focused (secondary) pane.
    expect(activeTab()).toBe("secondary-tab");
  });

  it("closeSplit collapses to single pane and restores the primary tab as active", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().closeSplit(W);
    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(false);
    expect(split.secondaryTabId).toBeNull();
    expect(split.focusedPane).toBe("primary");
    expect(activeTab()).toBe("primary-tab");
  });

  it("setFocusedPane mirrors that pane's tab into activeTabId", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    expect(activeTab()).toBe("secondary-tab");
    usePaneStore.getState().setFocusedPane(W, "primary");
    expect(usePaneStore.getState().getSplit(W).focusedPane).toBe("primary");
    expect(activeTab()).toBe("primary-tab");
  });

  it("setFocusedPaneTab swaps the focused pane's document and activeTabId", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // secondary focused
    usePaneStore.getState().setFocusedPaneTab(W, "other-tab");
    expect(usePaneStore.getState().getSplit(W).secondaryTabId).toBe("other-tab");
    expect(usePaneStore.getState().getSplit(W).primaryTabId).toBe("primary-tab"); // untouched
    expect(activeTab()).toBe("other-tab");
  });

  it("clamps the fraction into [0.2, 0.8]", () => {
    usePaneStore.getState().setFraction(W, 0.05);
    expect(usePaneStore.getState().getSplit(W).fraction).toBe(MIN_PANE_FRACTION);
    usePaneStore.getState().setFraction(W, 0.99);
    expect(usePaneStore.getState().getSplit(W).fraction).toBe(MAX_PANE_FRACTION);
  });

  it("setOrientation and toggleSyncScroll work", () => {
    usePaneStore.getState().setOrientation(W, "vertical");
    expect(usePaneStore.getState().getSplit(W).orientation).toBe("vertical");
    usePaneStore.getState().toggleSyncScroll(W);
    expect(usePaneStore.getState().getSplit(W).syncScroll).toBe(true);
  });

  it("handleTabClosed collapses the split when the secondary pane's tab is closed (H1)", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().handleTabClosed(W, "secondary-tab");
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("handleTabClosed collapses the split when the primary pane's tab is closed (H1)", () => {
    useTabStore.setState({ activeTabId: { [W]: "primary-tab" } } as never);
    usePaneStore.getState().openSplit(W, "secondary-tab"); // primaryTabId = "primary-tab"
    usePaneStore.getState().handleTabClosed(W, "primary-tab");
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("handleTabClosed ignores tabs not shown in either pane", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().handleTabClosed(W, "some-other-tab");
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(true);
  });

  it("handleTabClosed does NOT collapse when the tab is still present (close refused)", () => {
    // Simulate a pinned-tab refusal: the tab is a pane's doc but still exists
    // in the window (tabStore declined to remove it).
    const secondary = useTabStore.getState().createTab(W, "/pinned.md");
    useTabStore.getState().setActiveTab(W, secondary);
    usePaneStore.getState().openSplit(W, secondary); // secondary in a pane, still present
    usePaneStore.getState().handleTabClosed(W, secondary);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(true); // not collapsed
    useTabStore.getState().removeWindow(W);
  });

  it("mirrors a null tab into activeTabId when the focused pane is empty (ADR-1)", () => {
    // Open a split whose secondary pane has no document, then focus it.
    usePaneStore.getState().openSplit(W, null); // focuses the empty secondary
    // The alias must not keep pointing at the primary tab — the focused pane
    // is empty, so activeTabId is null.
    expect(activeTab()).toBeNull();
  });

  it("restores the alias when focus returns to a non-empty pane", () => {
    usePaneStore.getState().openSplit(W, null); // empty secondary focused ⇒ alias null
    expect(activeTab()).toBeNull();
    usePaneStore.getState().setFocusedPane(W, "primary");
    expect(activeTab()).toBe("primary-tab");
  });

  it("removeWindow drops the window's state", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().removeWindow(W);
    expect(usePaneStore.getState().byWindow[W]).toBeUndefined();
    expect(() => usePaneStore.getState().removeWindow("ghost")).not.toThrow();
  });
});
