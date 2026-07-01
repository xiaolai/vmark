/**
 * Integration: tabStore's close/detach choke point reconciles the paneStore
 * split (#1081). Every tab-removal path routes through closeTab/detachTab, so a
 * single place collapses a split whose pane held the removed tab — and leaves
 * it alone when the removal is declined (pinned).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "./tabStore";
import { usePaneStore } from "./paneStore";

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

  it("closing a NON-paned tab leaves the split open", () => {
    openSplitWithTabs();
    const other = useTabStore.getState().createTab(W, "/c.md");
    useTabStore.getState().closeTab(W, other);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(true);
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
