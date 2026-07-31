/**
 * closeTab's return value — WI-5.
 *
 * Callers must know whether removal actually happened: a pinned refusal used
 * to be indistinguishable from success, so per-tab state was wiped for a tab
 * still on screen. Own file because tabStore.test.ts sits at its frozen
 * size baseline.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "@/stores/tabStore";

describe("tabStore.closeTab return value", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  });

  it("returns true when the tab was removed", () => {
    const store = useTabStore.getState();
    const id = store.createTab("main", "/tmp/r.md");
    expect(store.closeTab("main", id)).toBe(true);
    expect(useTabStore.getState().tabs["main"]).toEqual([]);
  });

  it("returns false for a pinned tab, leaving it in place", () => {
    const store = useTabStore.getState();
    const id = store.createTab("main", "/tmp/p.md");
    store.togglePin("main", id);
    expect(useTabStore.getState().closeTab("main", id)).toBe(false);
    expect(useTabStore.getState().tabs["main"]?.some((t) => t.id === id)).toBe(true);
  });

  it("returns false for an unknown tab", () => {
    expect(useTabStore.getState().closeTab("main", "no-such-tab")).toBe(false);
  });
});
