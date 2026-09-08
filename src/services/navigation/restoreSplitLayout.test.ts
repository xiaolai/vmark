// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { restoreSplitLayout } from "./restoreWorkspaceTabs";
import { saveSplitLayout } from "@/services/persistence/splitLayoutPersistence";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useDocumentStore } from "@/stores/documentStore";
import { onTabActivated } from "@/stores/tabActivationBus";

const W = "main";
const ROOT = "/project";

/** findExistingTabForPath matches on the DOCUMENT's filePath, so init both. */
function openDoc(path: string): string {
  const tabId = useTabStore.getState().createTab(W, path);
  useDocumentStore.getState().initDocument(tabId, "", path);
  return tabId;
}

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useTabStore.getState().removeWindow(W);
  localStorage.clear();
});

describe("restoreSplitLayout (#1081 Phase 4)", () => {
  it("re-opens the split with the persisted primary and secondary panes", () => {
    const primary = openDoc("/a.md");
    const secondary = openDoc("/b.md");
    // Deliberately leave the SECONDARY active to prove restore pins the primary
    // deterministically rather than trusting whichever tab is active.
    useTabStore.getState().setActiveTab(W, secondary);

    saveSplitLayout(ROOT, {
      fraction: 0.35,
      syncScroll: true,
      primaryPath: "/a.md",
      secondaryPath: "/b.md",
    });

    restoreSplitLayout(W, ROOT);

    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(true);
    expect(split.primaryTabId).toBe(primary);
    expect(split.secondaryTabId).toBe(secondary);
    expect(split.fraction).toBeCloseTo(0.35);
    expect(split.syncScroll).toBe(true);
  });

  it("is a no-op when the secondary doc isn't open (moved/closed)", () => {
    openDoc("/a.md");
    saveSplitLayout(ROOT, {
      fraction: 0.5,
      syncScroll: false,
      primaryPath: "/a.md",
      secondaryPath: "/missing.md",
    });
    restoreSplitLayout(W, ROOT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("is a no-op when the primary doc isn't open", () => {
    openDoc("/b.md");
    saveSplitLayout(ROOT, {
      fraction: 0.5,
      syncScroll: false,
      primaryPath: "/missing.md",
      secondaryPath: "/b.md",
    });
    restoreSplitLayout(W, ROOT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("is a no-op when both paths resolve to the same tab", () => {
    openDoc("/a.md");
    saveSplitLayout(ROOT, {
      fraction: 0.5,
      syncScroll: false,
      primaryPath: "/a.md",
      secondaryPath: "/a.md",
    });
    restoreSplitLayout(W, ROOT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("restores a layout persisted with the removed `orientation: \"vertical\"` as the side-by-side split (WI-FL3.10)", () => {
    const primary = openDoc("/a.md");
    const secondary = openDoc("/b.md");
    useTabStore.getState().setActiveTab(W, secondary);
    // Written by a build that still had a stacked orientation; it must still restore.
    localStorage.setItem(
      `vmark-split-layout:${ROOT}`,
      JSON.stringify({
        orientation: "vertical",
        fraction: 0.35,
        syncScroll: false,
        primaryPath: "/a.md",
        secondaryPath: "/b.md",
      }),
    );

    restoreSplitLayout(W, ROOT);

    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(true);
    expect(split.primaryTabId).toBe(primary);
    expect(split.secondaryTabId).toBe(secondary);
    expect(split.fraction).toBeCloseTo(0.35);
    expect(split).not.toHaveProperty("orientation");
  });

  it("is a no-op when no layout is persisted", () => {
    restoreSplitLayout(W, ROOT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });
});

// Audit #985 — this runs immediately after restoreWorkspaceTabs collapsed the
// MRU precisely so restoration would not look like browsing. Its own
// activations went out under the default `user` origin and put the fabricated
// history straight back.
describe("split restoration announces a RESTORE, not a user activation", () => {
  it("labels every activation it causes", () => {
    const primary = openDoc("/a.md");
    openDoc("/b.md");
    saveSplitLayout(ROOT, {
      fraction: 0.5,
      syncScroll: false,
      primaryPath: "/a.md",
      secondaryPath: "/b.md",
    });

    const origins: string[] = [];
    const unsubscribe = onTabActivated((_w, _tabId, origin) => origins.push(origin));
    try {
      restoreSplitLayout(W, ROOT);
    } finally {
      unsubscribe();
    }

    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((o) => o === "restore")).toBe(true);
    expect(usePaneStore.getState().getSplit(W).primaryTabId).toBe(primary);
  });

  it("restores the previous origin afterwards, so later activations are the user's", () => {
    openDoc("/a.md");
    const secondary = openDoc("/b.md");
    saveSplitLayout(ROOT, {
      fraction: 0.5,
      syncScroll: false,
      primaryPath: "/a.md",
      secondaryPath: "/b.md",
    });
    restoreSplitLayout(W, ROOT);

    const origins: string[] = [];
    const unsubscribe = onTabActivated((_w, _tabId, origin) => origins.push(origin));
    try {
      useTabStore.getState().setActiveTab(W, secondary);
    } finally {
      unsubscribe();
    }

    expect(origins).toEqual(["user"]);
  });
});
