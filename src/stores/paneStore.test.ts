// @vitest-environment node
// WI-10.1 — atomic pane replacement (replaceWindowSplit) tests
import { describe, it, expect, beforeEach } from "vitest";
import { usePaneStore, DEFAULT_SPLIT, MIN_PANE_FRACTION, MAX_PANE_FRACTION } from "./paneStore";
import { useTabStore } from "./tabStore";

const W = "main";

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  // Both tabs must actually EXIST in the window: `setActiveTab` now refuses an id the
  // window does not contain (a foreign/stale id would otherwise become the active tab and
  // resolve to nothing). A split only ever activates tabs that are already open, so this
  // reflects production — the old setup stubbed `activeTabId` alone, which was an
  // unreachable state.
  useTabStore.setState({
    tabs: {
      [W]: [
        { id: "primary-tab", kind: "document", title: "p", filePath: null, isPinned: false },
        { id: "secondary-tab", kind: "document", title: "s", filePath: null, isPinned: false },
        { id: "other-tab", kind: "document", title: "o", filePath: null, isPinned: false },
      ],
    },
    activeTabId: { [W]: "primary-tab" },
  } as never);
});

function activeTab() {
  return useTabStore.getState().activeTabId[W];
}

/** Simulate a real tab close: tabStore removes the tab, THEN paneStore.handleTabClosed
 *  reacts. handleTabClosed only collapses when the tab is actually gone (a still-present
 *  tab means the close was declined, e.g. a pinned tab). */
function removeFromWindow(tabId: string) {
  useTabStore.setState((state) => ({
    tabs: { ...state.tabs, [W]: (state.tabs[W] ?? []).filter((t) => t.id !== tabId) },
  }));
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
    removeFromWindow("secondary-tab"); // the real close removes it first; then the handler reacts
    usePaneStore.getState().handleTabClosed(W, "secondary-tab");
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("handleTabClosed collapses the split when the primary pane's tab is closed (H1)", () => {
    useTabStore.setState({ activeTabId: { [W]: "primary-tab" } } as never);
    usePaneStore.getState().openSplit(W, "secondary-tab"); // primaryTabId = "primary-tab"
    removeFromWindow("primary-tab");
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

// WI-10.1 — atomic pane replacement: the ONE validated action that applies a
// (possibly stashed) split and performs the single final activeTabId sync
// (ADR-1 alias invariant). Used by the rail-switch coordinator (WI-2R/10.2).
describe("replaceWindowSplit (WI-10.1)", () => {
  function split(over: Partial<typeof DEFAULT_SPLIT>) {
    return { ...DEFAULT_SPLIT, ...over };
  }

  it("restores a valid two-pane split and aliases the focused pane's tab", () => {
    usePaneStore.getState().replaceWindowSplit(
      W,
      split({
        enabled: true,
        primaryTabId: "primary-tab",
        secondaryTabId: "secondary-tab",
        focusedPane: "secondary",
        fraction: 0.3,
      }),
      "other-tab",
    );

    const applied = usePaneStore.getState().getSplit(W);
    expect(applied).toMatchObject({
      enabled: true,
      primaryTabId: "primary-tab",
      secondaryTabId: "secondary-tab",
      focusedPane: "secondary",
      fraction: 0.3,
    });
    expect(activeTab()).toBe("secondary-tab");
  });

  it("collapses to the surviving pane when the other tab is gone", () => {
    usePaneStore.getState().replaceWindowSplit(
      W,
      split({
        enabled: true,
        primaryTabId: "gone-tab",
        secondaryTabId: "secondary-tab",
        focusedPane: "primary",
      }),
      "other-tab",
    );

    const applied = usePaneStore.getState().getSplit(W);
    expect(applied.enabled).toBe(false);
    expect(activeTab()).toBe("secondary-tab");
  });

  it("falls back to the provided active tab when no pane tab survives", () => {
    usePaneStore.getState().replaceWindowSplit(
      W,
      split({ enabled: true, primaryTabId: "gone-1", secondaryTabId: "gone-2" }),
      "other-tab",
    );

    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
    expect(activeTab()).toBe("other-tab");
  });

  it("null split applies single pane with the fallback tab", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().replaceWindowSplit(W, null, "other-tab");

    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
    expect(activeTab()).toBe("other-tab");
  });

  it("null fallback with no surviving panes clears the active tab", () => {
    usePaneStore.getState().replaceWindowSplit(W, null, null);
    expect(activeTab()).toBeNull();
  });

  it("rejects a duplicate pane id (collapses to that single tab)", () => {
    usePaneStore.getState().replaceWindowSplit(
      W,
      split({ enabled: true, primaryTabId: "primary-tab", secondaryTabId: "primary-tab" }),
      "other-tab",
    );

    const applied = usePaneStore.getState().getSplit(W);
    expect(applied.enabled).toBe(false);
    expect(activeTab()).toBe("primary-tab");
  });

  it("rejects a browser tab in a pane (documents only)", () => {
    useTabStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [W]: [
          ...(state.tabs[W] ?? []),
          { id: "web-tab", kind: "browser", title: "w", isPinned: false } as never,
        ],
      },
    }));

    usePaneStore.getState().replaceWindowSplit(
      W,
      split({ enabled: true, primaryTabId: "primary-tab", secondaryTabId: "web-tab" }),
      "other-tab",
    );

    const applied = usePaneStore.getState().getSplit(W);
    expect(applied.enabled).toBe(false);
    expect(activeTab()).toBe("primary-tab");
  });

  it("clamps an out-of-range fraction", () => {
    usePaneStore.getState().replaceWindowSplit(
      W,
      split({
        enabled: true,
        primaryTabId: "primary-tab",
        secondaryTabId: "secondary-tab",
        fraction: 0.05,
      }),
      null,
    );

    expect(usePaneStore.getState().getSplit(W).fraction).toBe(MIN_PANE_FRACTION);
  });
});
