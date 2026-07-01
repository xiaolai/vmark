import { describe, it, expect, beforeEach } from "vitest";
import { restoreSplitLayout } from "./restoreWorkspaceTabs";
import { saveSplitLayout } from "@/services/persistence/splitLayoutPersistence";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useDocumentStore } from "@/stores/documentStore";

const W = "main";
const ROOT = "/project";

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useTabStore.getState().removeWindow(W);
  localStorage.clear();
});

describe("restoreSplitLayout (#1081 Phase 4)", () => {
  it("re-opens the split when the secondary doc is present", () => {
    // findExistingTabForPath matches on the DOCUMENT's filePath, so init both.
    const primary = useTabStore.getState().createTab(W, "/a.md");
    const secondary = useTabStore.getState().createTab(W, "/b.md");
    useDocumentStore.getState().initDocument(primary, "", "/a.md");
    useDocumentStore.getState().initDocument(secondary, "", "/b.md");
    useTabStore.getState().setActiveTab(W, primary); // primary pane = active

    saveSplitLayout(ROOT, {
      orientation: "vertical",
      fraction: 0.35,
      syncScroll: true,
      secondaryPath: "/b.md",
    });

    restoreSplitLayout(W, ROOT);

    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(true);
    expect(split.secondaryTabId).toBe(secondary);
    expect(split.primaryTabId).toBe(primary);
    expect(split.orientation).toBe("vertical");
    expect(split.fraction).toBeCloseTo(0.35);
    expect(split.syncScroll).toBe(true);
  });

  it("is a no-op when the secondary doc isn't open (moved/closed)", () => {
    useTabStore.getState().createTab(W, "/a.md");
    saveSplitLayout(ROOT, {
      orientation: "horizontal",
      fraction: 0.5,
      syncScroll: false,
      secondaryPath: "/missing.md",
    });
    restoreSplitLayout(W, ROOT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("is a no-op when no layout is persisted", () => {
    restoreSplitLayout(W, ROOT);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });
});
