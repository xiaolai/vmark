import { describe, it, expect, beforeEach } from "vitest";
import { restoreSplitLayout } from "./restoreWorkspaceTabs";
import { saveSplitLayout } from "@/services/persistence/splitLayoutPersistence";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useDocumentStore } from "@/stores/documentStore";

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
      orientation: "vertical",
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
    expect(split.orientation).toBe("vertical");
    expect(split.fraction).toBeCloseTo(0.35);
    expect(split.syncScroll).toBe(true);
  });

  it("is a no-op when the secondary doc isn't open (moved/closed)", () => {
    openDoc("/a.md");
    saveSplitLayout(ROOT, {
      orientation: "horizontal",
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
      orientation: "horizontal",
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
      orientation: "horizontal",
      fraction: 0.5,
      syncScroll: false,
      primaryPath: "/a.md",
      secondaryPath: "/a.md",
    });
    restoreSplitLayout(W, ROOT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("is a no-op when no layout is persisted", () => {
    restoreSplitLayout(W, ROOT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });
});
