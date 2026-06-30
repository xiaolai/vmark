import { describe, it, expect, beforeEach } from "vitest";
import { usePaneStore, DEFAULT_SPLIT, MIN_PANE_FRACTION, MAX_PANE_FRACTION } from "./paneStore";

const W = "main";

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
});

describe("paneStore", () => {
  it("defaults to a disabled single-pane split for unknown windows", () => {
    expect(usePaneStore.getState().getSplit(W)).toEqual(DEFAULT_SPLIT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("openSplit enables the split, sets the secondary tab, and focuses it", () => {
    usePaneStore.getState().openSplit(W, "tab-2");
    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(true);
    expect(split.secondaryTabId).toBe("tab-2");
    expect(split.focusedPane).toBe("secondary");
  });

  it("closeSplit collapses to single pane and clears the secondary tab + focus", () => {
    usePaneStore.getState().openSplit(W, "tab-2");
    usePaneStore.getState().closeSplit(W);
    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(false);
    expect(split.secondaryTabId).toBeNull();
    expect(split.focusedPane).toBe("primary");
  });

  it("setSecondaryTab and setFocusedPane update only their fields", () => {
    usePaneStore.getState().openSplit(W, "tab-2");
    usePaneStore.getState().setSecondaryTab(W, "tab-3");
    usePaneStore.getState().setFocusedPane(W, "primary");
    const split = usePaneStore.getState().getSplit(W);
    expect(split.secondaryTabId).toBe("tab-3");
    expect(split.focusedPane).toBe("primary");
    expect(split.enabled).toBe(true);
  });

  it("clamps the fraction into [0.2, 0.8]", () => {
    usePaneStore.getState().setFraction(W, 0.05);
    expect(usePaneStore.getState().getSplit(W).fraction).toBe(MIN_PANE_FRACTION);
    usePaneStore.getState().setFraction(W, 0.99);
    expect(usePaneStore.getState().getSplit(W).fraction).toBe(MAX_PANE_FRACTION);
    usePaneStore.getState().setFraction(W, 0.42);
    expect(usePaneStore.getState().getSplit(W).fraction).toBeCloseTo(0.42);
  });

  it("setOrientation and toggleSyncScroll work", () => {
    usePaneStore.getState().setOrientation(W, "vertical");
    expect(usePaneStore.getState().getSplit(W).orientation).toBe("vertical");
    expect(usePaneStore.getState().getSplit(W).syncScroll).toBe(false);
    usePaneStore.getState().toggleSyncScroll(W);
    expect(usePaneStore.getState().getSplit(W).syncScroll).toBe(true);
    usePaneStore.getState().toggleSyncScroll(W);
    expect(usePaneStore.getState().getSplit(W).syncScroll).toBe(false);
  });

  it("removeWindow drops the window's state", () => {
    usePaneStore.getState().openSplit(W, "tab-2");
    usePaneStore.getState().removeWindow(W);
    expect(usePaneStore.getState().byWindow[W]).toBeUndefined();
    // removeWindow on an absent window is a no-op (no throw, same ref semantics).
    expect(() => usePaneStore.getState().removeWindow("ghost")).not.toThrow();
  });

  it("does not mutate other windows", () => {
    usePaneStore.getState().openSplit("main", "tab-2");
    usePaneStore.getState().openSplit("doc-1", "tab-9");
    expect(usePaneStore.getState().getSplit("main").secondaryTabId).toBe("tab-2");
    expect(usePaneStore.getState().getSplit("doc-1").secondaryTabId).toBe("tab-9");
  });
});
