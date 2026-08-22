// @vitest-environment node
//
// WI-TNAV2.5 — restore is MRU-neutral.
//
// Against the REAL store and the REAL bus: an isolated empty-store test cannot
// decide this, because the defect is that restore ACTIVATES each tab as it
// recreates it. Restoring A, B, C with A active fabricates [A, C, B] — an order
// the user never produced — and `tab.lastUsed` would then jump somewhere
// arbitrary on the first press of a session.
import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore } from "./tabStore";
import { useTabMruStore, collapseMruToActive } from "./tabMruStore";

const W = "main";
const mru = () => useTabMruStore.getState().keys(W);

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  useTabMruStore.getState().reset();
});

describe("restore leaves exactly one MRU entry", () => {
  it("is applied on BOTH restore paths, not just hot exit", async () => {
    // The first pass wired only `restoreTabsHelpers`. The workspace-session
    // path opens each `lastOpenTabs` entry with an activating `createTab` too,
    // so it fabricated an MRU in reverse-restore order.
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "src/services/persistence/hotExit/restoreTabsHelpers.ts",
      "src/services/navigation/restoreWorkspaceTabs.ts",
    ]) {
      expect(readFileSync(f, "utf8")).toContain("collapseMruToActive");
    }
  });

  it("collapses a fabricated restore order to the active tab alone", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    const c = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a);
    // What a naive restore leaves behind.
    expect(mru()).toEqual([a, c, b]);

    collapseMruToActive(W);
    expect(mru()).toEqual([a]);
    expect(b).not.toBe(c);
  });

  it("leaves an empty list when the window has no active tab", () => {
    useTabStore.setState({ tabs: { [W]: [] }, activeTabId: { [W]: null } } as never);
    collapseMruToActive(W);
    expect(mru()).toEqual([]);
  });

  it("collapses a browser workspace to its single key, not a page id", () => {
    const p1 = useTabStore.getState().createBrowserPage(W, "https://one.example");
    const p2 = useTabStore.getState().createBrowserPage(W, "https://two.example");
    collapseMruToActive(W);
    expect(mru()).toHaveLength(1);
    expect(mru()[0]).not.toBe(p1);
    expect(mru()[0]).not.toBe(p2);
  });

  it("does not touch another window", () => {
    useTabStore.getState().createTab(W, null);
    const other = useTabStore.getState().createTab("w2", null);
    collapseMruToActive(W);
    expect(useTabMruStore.getState().keys("w2")).toEqual([other]);
  });

  it("clears the MRU when the window is torn down in bulk", () => {
    // `restoreTabsHelpers.ts:55` clears via `tabStore.removeWindow`, which goes
    // through neither bus — the MRU store observes the store instead.
    useTabStore.getState().createTab(W, null);
    useTabStore.getState().removeWindow(W);
    expect(mru()).toEqual([]);
  });
});
