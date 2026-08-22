// @vitest-environment node
//
// WI-DSPL1.7 — D9 (A/A is illegal), R4 (guards on the OPEN path only),
// R6 (visible document tabs only).
import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useTabMruStore } from "@/stores/tabMruStore";
import { toggleSplitDocuments } from "./toggleSplitDocuments";

const W = "main";
const split = () => usePaneStore.getState().getSplit(W);

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  usePaneStore.setState({ byWindow: {} });
  useTabMruStore.getState().reset();
});

describe("toggleSplitDocuments", () => {
  it("never produces an A/A split (D9)", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    toggleSplitDocuments(W);

    const s = split();
    expect(s.enabled).toBe(true);
    expect(s.primaryTabId).not.toBe(s.secondaryTabId);
    expect(new Set([s.primaryTabId, s.secondaryTabId])).toEqual(new Set([a, b]));
  });

  it("opens beside the most-recently-used other document", () => {
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    const c = useTabStore.getState().createTab(W, null);
    useTabStore.getState().setActiveTab(W, a); // MRU: [a, c, b]
    toggleSplitDocuments(W);
    expect(split().secondaryTabId).toBe(c);
    expect(b).not.toBe(c);
  });

  it("is an involution — toggling twice returns to a single pane", () => {
    useTabStore.getState().createTab(W, null);
    useTabStore.getState().createTab(W, null);
    toggleSplitDocuments(W);
    expect(split().enabled).toBe(true);
    toggleSplitDocuments(W);
    expect(split().enabled).toBe(false);
  });

  it("no-ops with fewer than two documents", () => {
    useTabStore.getState().createTab(W, null);
    toggleSplitDocuments(W);
    expect(split().enabled).toBe(false);
  });

  it("no-ops on the empty Welcome screen", () => {
    toggleSplitDocuments(W);
    expect(split().enabled).toBe(false);
  });

  it("no-ops when a BROWSER tab is active", () => {
    // `getActiveTabId` accepts any kind, so the shipped version could seed a
    // browser/browser split despite "browser tabs never touch panes".
    useTabStore.getState().createTab(W, null);
    useTabStore.getState().createTab(W, null);
    useTabStore.getState().createBrowserPage(W, "https://one.example");
    toggleSplitDocuments(W);
    expect(split().enabled).toBe(false);
  });

  it("the CLOSE direction never no-ops, even below the open threshold (R4)", () => {
    // The trap: putting the two-document guard before the enabled check traps
    // the user inside a split. Reached here by closing down to one document.
    const a = useTabStore.getState().createTab(W, null);
    const b = useTabStore.getState().createTab(W, null);
    toggleSplitDocuments(W);
    expect(split().enabled).toBe(true);

    useTabStore.getState().closeTab(W, b);
    usePaneStore.setState((s) => ({
      byWindow: { ...s.byWindow, [W]: { ...s.byWindow[W], enabled: true, primaryTabId: a } },
    }));

    toggleSplitDocuments(W);
    expect(split().enabled).toBe(false);
  });
});
