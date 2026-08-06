/**
 * Integration: tabStore ⇄ paneStore reconciliation (#1081, WI-2).
 *
 * Close/detach: every tab-removal path routes through closeTab/detachTab, so a
 * single place collapses a split whose pane held the removed tab — and leaves
 * it alone when the removal is declined (pinned).
 *
 * Activation (WI-2, decision D2 in .claude/tdd-guardian/decisions-20260803.md):
 * every activation path — createTab, createTransferredTab, setActiveTab, the
 * post-close neighbor pick — converges the split through the tabActivationBus
 * seam. Focus FOLLOWS a tab already shown in the other pane; an unpaned
 * document lands in the focused pane; the ADR-1 invariant (focused pane's tab
 * === tabStore.activeTabId) holds after every step and is DEV-asserted by
 * paneStore's assertPaneTabInvariant.
 *
 * Real Zustand stores throughout (WI-18 mock boundary: no @/stores mocks).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "./tabStore";
import { usePaneStore, assertPaneTabInvariant } from "./paneStore";

const W = "main";

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useTabStore.getState().removeWindow(W);
});

/** Open a split with two real tabs; returns [primary, secondary]. */
function openSplitWithTabs(): [string, string] {
  const primary = useTabStore.getState().createTab(W, "/a.md");
  const secondary = useTabStore.getState().createTab(W, "/b.md");
  useTabStore.getState().setActiveTab(W, primary);
  usePaneStore.getState().openSplit(W, secondary);
  return [primary, secondary];
}

/** The tab the FOCUSED pane displays — the ADR-1 alias target. */
function focusedPaneTab(): string | null {
  const split = usePaneStore.getState().getSplit(W);
  return split.focusedPane === "primary" ? split.primaryTabId : split.secondaryTabId;
}

describe("tabStore ⇄ paneStore close/detach reconciliation (#1081)", () => {
  it("closeTab on a paned tab collapses the split", () => {
    const [, secondary] = openSplitWithTabs();
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(true);
    useTabStore.getState().closeTab(W, secondary);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("closeTab on the PRIMARY paned tab collapses the split", () => {
    const [primary] = openSplitWithTabs();
    useTabStore.getState().closeTab(W, primary);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("detachTab on a paned tab collapses the split (drag-out / move-to-window)", () => {
    const [, secondary] = openSplitWithTabs();
    useTabStore.getState().detachTab(W, secondary);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("closing a tab shown in NO pane leaves the split open and the alias converged (WI-2)", () => {
    const [primary, secondary] = openSplitWithTabs(); // panes a/b, focus secondary
    // WI-2: the created tab lands in the focused (secondary) pane, displacing b.
    const extra = useTabStore.getState().createTab(W, "/c.md");
    expect(usePaneStore.getState().getSplit(W).secondaryTabId).toBe(extra);
    // b is now shown in no pane — closing it must not collapse the split.
    useTabStore.getState().closeTab(W, secondary);
    const after = usePaneStore.getState().getSplit(W);
    expect(after.enabled).toBe(true);
    expect(after.primaryTabId).toBe(primary);
    expect(after.secondaryTabId).toBe(extra);
    // ADR-1 invariant: the alias is the focused pane's tab, untouched by the close.
    expect(useTabStore.getState().activeTabId[W]).toBe(extra);
    expect(focusedPaneTab()).toBe(extra);
  });

  it("a refused close of a PINNED paned tab does NOT collapse the split", () => {
    const [, secondary] = openSplitWithTabs();
    useTabStore.getState().togglePin(W, secondary); // pinned ⇒ closeTab refuses
    useTabStore.getState().closeTab(W, secondary);
    // Tab still open, split intact.
    expect(useTabStore.getState().tabs[W].some((t) => t.id === secondary)).toBe(true);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(true);
  });

  it("closing a tab with no split open is a harmless no-op", () => {
    const tab = useTabStore.getState().createTab(W, "/a.md");
    expect(() => useTabStore.getState().closeTab(W, tab)).not.toThrow();
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });
});

describe("tabStore activation ⇄ paneStore convergence (WI-2, D2)", () => {
  it("case 1: createTab under a split lands in the focused pane and keeps the alias converged", () => {
    openSplitWithTabs(); // focus = secondary
    const created = useTabStore.getState().createTab(W, "/c.md");
    expect(useTabStore.getState().activeTabId[W]).toBe(created);
    // RED today: the alias points at a tab no pane displays.
    expect(focusedPaneTab()).toBe(created);
    const split = usePaneStore.getState().getSplit(W);
    expect(
      [split.primaryTabId, split.secondaryTabId].filter((id) => id === created),
    ).toHaveLength(1); // shown in exactly ONE pane
  });

  it("createTransferredTab under a split converges the same way", () => {
    openSplitWithTabs();
    useTabStore.getState().createTransferredTab(W, {
      id: "tab-transferred",
      filePath: "/t.md",
      title: "t",
      isPinned: false,
    });
    expect(useTabStore.getState().activeTabId[W]).toBe("tab-transferred");
    expect(focusedPaneTab()).toBe("tab-transferred");
  });

  it("case 2: setActiveTab on the NON-focused pane's tab moves focus to that pane (D2 focus-follows-tab)", () => {
    const [primary, secondary] = openSplitWithTabs(); // focus secondary, alias = b
    useTabStore.getState().setActiveTab(W, primary);
    const split = usePaneStore.getState().getSplit(W);
    expect(split.focusedPane).toBe("primary"); // focus followed the tab
    expect(split.primaryTabId).toBe(primary); // both panes keep their documents
    expect(split.secondaryTabId).toBe(secondary);
    expect(useTabStore.getState().activeTabId[W]).toBe(primary);
  });

  it("case 4: closing the focused pane's active tab collapses the split and activates the neighbor", () => {
    const [primary, secondary] = openSplitWithTabs(); // focus secondary, alias = b
    useTabStore.getState().closeTab(W, secondary);
    // Shipped #1081 behavior preserved: the split collapses; the neighbor activates.
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
    expect(useTabStore.getState().activeTabId[W]).toBe(primary);
  });

  it("case 5: DEV assertion fires on an injected desync; dev=false is silent and touches nothing", () => {
    const [primary] = openSplitWithTabs(); // focus secondary, alias = b
    expect(() => assertPaneTabInvariant(W)).not.toThrow(); // consistent → silent
    // Raw setState bypasses every activation path — the exact desync class.
    useTabStore.setState((s) => ({ activeTabId: { ...s.activeTabId, [W]: primary } }));
    expect(() => assertPaneTabInvariant(W)).toThrow(/ADR-1/);
    // Production (dev=false): silent no-op, state untouched (reference equality).
    const tabsBefore = useTabStore.getState().tabs;
    const activeBefore = useTabStore.getState().activeTabId;
    const panesBefore = usePaneStore.getState().byWindow;
    expect(() => assertPaneTabInvariant(W, false)).not.toThrow();
    expect(useTabStore.getState().tabs).toBe(tabsBefore);
    expect(useTabStore.getState().activeTabId).toBe(activeBefore);
    expect(usePaneStore.getState().byWindow).toBe(panesBefore);
  });

  it("case 6: setActiveTab with an unknown id is a guarded no-op — stores deep-equal before/after", () => {
    openSplitWithTabs();
    const tabsBefore = useTabStore.getState().tabs;
    const activeBefore = useTabStore.getState().activeTabId;
    const panesBefore = usePaneStore.getState().byWindow;
    useTabStore.getState().setActiveTab(W, "nope");
    expect(useTabStore.getState().tabs).toEqual(tabsBefore);
    expect(useTabStore.getState().activeTabId).toEqual(activeBefore);
    expect(usePaneStore.getState().byWindow).toEqual(panesBefore);
  });

  it("case 7: rapid alternating activation across panes keeps the invariant at every step", () => {
    const [primary, secondary] = openSplitWithTabs();
    for (let i = 0; i < 10; i++) {
      const target = i % 2 === 0 ? primary : secondary;
      useTabStore.getState().setActiveTab(W, target);
      expect(useTabStore.getState().activeTabId[W]).toBe(target);
      expect(focusedPaneTab()).toBe(target);
      const split = usePaneStore.getState().getSplit(W);
      expect(split.primaryTabId).toBe(primary); // panes never churn documents
      expect(split.secondaryTabId).toBe(secondary);
    }
  });
});
