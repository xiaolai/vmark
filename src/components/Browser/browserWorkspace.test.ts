import { describe, expect, it } from "vitest";
import type { Tab } from "@/stores/tabStoreTypes";
import { getBrowserWorkspaceView } from "./browserWorkspace";

function documentTab(id: string): Tab {
  return {
    kind: "document",
    id,
    title: `${id}.md`,
    filePath: `/${id}.md`,
    formatId: "markdown",
    isPinned: false,
  };
}

function browserTab(id: string, title = id): Tab {
  return {
    kind: "browser",
    id,
    title,
    url: `https://${id}.example/`,
    isPinned: false,
    automationMode: "human",
    persistPolicy: "restore-human",
  };
}

describe("getBrowserWorkspaceView", () => {
  it("keeps document tabs and groups all browser pages into one workspace", () => {
    const view = getBrowserWorkspaceView(
      [documentTab("notes"), browserTab("weibo", "Weibo"), browserTab("docs", "Docs")],
      "docs",
    );

    expect(view.documentTabs.map((tab) => tab.id)).toEqual(["notes"]);
    expect(view.browserPages.map((tab) => tab.id)).toEqual(["weibo", "docs"]);
    expect(view.browserWorkspaceTabId).toBe("weibo");
    expect(view.activeBrowserPageId).toBe("docs");
    expect(view.browserWorkspaceActive).toBe(true);
  });

  it("does not mark the browser workspace active while a document is active", () => {
    const view = getBrowserWorkspaceView(
      [browserTab("weibo"), documentTab("notes")],
      "notes",
    );

    expect(view.browserWorkspaceTabId).toBe("weibo");
    expect(view.activeBrowserPageId).toBeNull();
    expect(view.browserWorkspaceActive).toBe(false);
  });

  it("returns an empty workspace when there are no browser pages", () => {
    const view = getBrowserWorkspaceView([documentTab("notes")], "notes");

    expect(view.browserPages).toEqual([]);
    expect(view.browserWorkspaceTabId).toBeNull();
    expect(view.browserWorkspaceActive).toBe(false);
  });

  it("fails closed for a stale active tab id", () => {
    const view = getBrowserWorkspaceView([browserTab("weibo")], "missing");

    expect(view.activeBrowserPageId).toBeNull();
    expect(view.browserWorkspaceActive).toBe(false);
  });

  describe("browserReturnPageId (reopen target)", () => {
    const pages = [browserTab("a"), browserTab("b"), browserTab("c")];

    it("defaults to the first page when no last-active page is remembered", () => {
      expect(getBrowserWorkspaceView(pages, null).browserReturnPageId).toBe("a");
    });

    it("returns the remembered page when it still exists", () => {
      expect(getBrowserWorkspaceView(pages, null, "c").browserReturnPageId).toBe("c");
    });

    it("falls back to the first page when the remembered page was closed", () => {
      const view = getBrowserWorkspaceView([browserTab("a"), browserTab("c")], null, "b");
      expect(view.browserReturnPageId).toBe("a");
    });

    it("is null when there are no browser pages", () => {
      expect(getBrowserWorkspaceView([documentTab("notes")], "notes", "b").browserReturnPageId).toBeNull();
    });
  });
});
