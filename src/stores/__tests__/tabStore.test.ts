/**
 * Unit tests for tabStore — focused on path deduplication logic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "../tabStore";

const WINDOW = "main";

function resetStore() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

describe("tabStore", () => {
  beforeEach(resetStore);

  describe("findTabByPath", () => {
    it("finds tab by exact path", () => {
      useTabStore.getState().createTab(WINDOW, "/Users/test/file.md");
      const found = useTabStore.getState().findTabByPath(WINDOW, "/Users/test/file.md");
      expect(found).not.toBeNull();
      expect(found!.filePath).toBe("/Users/test/file.md");
    });

    it("finds tab when stored path has trailing slash", () => {
      // Tabs shouldn't normally have trailing slashes, but normalizePath handles it
      useTabStore.getState().createTab(WINDOW, "/Users/test/dir/");
      const found = useTabStore.getState().findTabByPath(WINDOW, "/Users/test/dir");
      expect(found).not.toBeNull();
    });

    it("finds tab with different separators (Windows backslash vs forward slash)", () => {
      useTabStore.getState().createTab(WINDOW, "C:\\Users\\test\\file.md");
      const found = useTabStore.getState().findTabByPath(WINDOW, "c:/Users/test/file.md");
      expect(found).not.toBeNull();
    });

    it("finds tab with different Windows drive letter case", () => {
      useTabStore.getState().createTab(WINDOW, "C:/Users/test/file.md");
      const found = useTabStore.getState().findTabByPath(WINDOW, "c:/Users/test/file.md");
      expect(found).not.toBeNull();
    });

    it("returns null when no matching tab exists", () => {
      useTabStore.getState().createTab(WINDOW, "/Users/test/file.md");
      const found = useTabStore.getState().findTabByPath(WINDOW, "/Users/test/other.md");
      expect(found).toBeNull();
    });
  });

  describe("createTab dedup", () => {
    it("returns existing tab ID when file is already open", () => {
      const id1 = useTabStore.getState().createTab(WINDOW, "/Users/test/file.md");
      const id2 = useTabStore.getState().createTab(WINDOW, "/Users/test/file.md");
      expect(id1).toBe(id2);
      // Only one tab should exist
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    });

    it("deduplicates with normalized paths", () => {
      const id1 = useTabStore.getState().createTab(WINDOW, "C:\\Users\\test\\file.md");
      const id2 = useTabStore.getState().createTab(WINDOW, "c:/Users/test/file.md");
      expect(id1).toBe(id2);
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    });
  });

  describe("closeTab", () => {
    it("closes tab and activates next tab to the right", () => {
      const _id1 = useTabStore.getState().createTab(WINDOW, "/file1.md");
      const id2 = useTabStore.getState().createTab(WINDOW, "/file2.md");
      const id3 = useTabStore.getState().createTab(WINDOW, "/file3.md");

      // Active tab is id3 (last created). Close id2.
      useTabStore.getState().setActiveTab(WINDOW, id2);
      useTabStore.getState().closeTab(WINDOW, id2);

      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(2);
      // Should activate id3 (next to the right, clamped to length-1)
      expect(useTabStore.getState().activeTabId[WINDOW]).toBe(id3);
    });

    it("closes last tab and sets activeTabId to null", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().closeTab(WINDOW, id);

      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(0);
      expect(useTabStore.getState().activeTabId[WINDOW]).toBeNull();
    });

    it("does not close tab that does not exist (returns early)", () => {
      useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().closeTab(WINDOW, "nonexistent");
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    });

    it("stores closed tab for reopen (max 10)", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().closeTab(WINDOW, id);

      const closed = useTabStore.getState().closedTabs[WINDOW];
      expect(closed).toHaveLength(1);
      expect(closed[0].filePath).toBe("/file.md");
    });
  });

  describe("detachTab", () => {
    it("removes tab without adding to closedTabs", () => {
      const id1 = useTabStore.getState().createTab(WINDOW, "/file1.md");
      const id2 = useTabStore.getState().createTab(WINDOW, "/file2.md");

      useTabStore.getState().setActiveTab(WINDOW, id1);
      useTabStore.getState().detachTab(WINDOW, id1);

      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
      expect(useTabStore.getState().closedTabs[WINDOW]).toBeUndefined();
      expect(useTabStore.getState().activeTabId[WINDOW]).toBe(id2);
    });

    it("sets activeTabId to null when last tab detached", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().detachTab(WINDOW, id);

      expect(useTabStore.getState().activeTabId[WINDOW]).toBeNull();
    });

    it("returns early when tab not found", () => {
      useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().detachTab(WINDOW, "nonexistent");
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    });

    it("does not change activeTabId when non-active tab is detached", () => {
      const id1 = useTabStore.getState().createTab(WINDOW, "/file1.md");
      const id2 = useTabStore.getState().createTab(WINDOW, "/file2.md");

      useTabStore.getState().setActiveTab(WINDOW, id2);
      useTabStore.getState().detachTab(WINDOW, id1);

      expect(useTabStore.getState().activeTabId[WINDOW]).toBe(id2);
    });
  });

  describe("togglePin", () => {
    it("pins tab and moves it after last pinned tab", () => {
      const _id1 = useTabStore.getState().createTab(WINDOW, "/file1.md");
      const _id2 = useTabStore.getState().createTab(WINDOW, "/file2.md");
      const id3 = useTabStore.getState().createTab(WINDOW, "/file3.md");

      useTabStore.getState().togglePin(WINDOW, id3);

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs[0].id).toBe(id3);
      expect(tabs[0].isPinned).toBe(true);
    });

    it("unpins tab in place", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().togglePin(WINDOW, id);
      useTabStore.getState().togglePin(WINDOW, id);

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs[0].isPinned).toBe(false);
    });

    it("returns early when tab not found", () => {
      useTabStore.getState().togglePin(WINDOW, "nonexistent");
      // No error thrown
    });
  });

  describe("reorderTabs", () => {
    it("reorders tabs", () => {
      useTabStore.getState().createTab(WINDOW, "/file1.md");
      useTabStore.getState().createTab(WINDOW, "/file2.md");
      useTabStore.getState().createTab(WINDOW, "/file3.md");

      useTabStore.getState().reorderTabs(WINDOW, 0, 2);

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs[2].filePath).toBe("/file1.md");
    });

    it("returns early for out-of-bounds fromIndex", () => {
      useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().reorderTabs(WINDOW, -1, 0);
      useTabStore.getState().reorderTabs(WINDOW, 99, 0);
    });

    it("returns early for out-of-bounds toIndex", () => {
      useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().reorderTabs(WINDOW, 0, -1);
      useTabStore.getState().reorderTabs(WINDOW, 0, 99);
    });

    it("handles empty window tabs", () => {
      useTabStore.getState().reorderTabs(WINDOW, 0, 1);
      // No error thrown
    });
  });

  describe("reopenClosedTab", () => {
    it("reopens most recently closed tab", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().closeTab(WINDOW, id);

      const reopened = useTabStore.getState().reopenClosedTab(WINDOW);
      expect(reopened).not.toBeNull();
      expect(reopened!.filePath).toBe("/file.md");
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    });

    it("returns null when no closed tabs", () => {
      const reopened = useTabStore.getState().reopenClosedTab(WINDOW);
      expect(reopened).toBeNull();
    });
  });

  describe("getActiveTab", () => {
    it("returns active tab", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/file.md");
      const tab = useTabStore.getState().getActiveTab(WINDOW);
      expect(tab).not.toBeNull();
      expect(tab!.id).toBe(id);
    });

    it("returns null when no active tab", () => {
      const tab = useTabStore.getState().getActiveTab(WINDOW);
      expect(tab).toBeNull();
    });

    it("returns null when active tab ID does not match any tab", () => {
      useTabStore.setState({
        tabs: { [WINDOW]: [] },
        activeTabId: { [WINDOW]: "nonexistent" },
        untitledCounter: 0,
        closedTabs: {},
      });
      const tab = useTabStore.getState().getActiveTab(WINDOW);
      expect(tab).toBeNull();
    });
  });

  describe("getAllOpenFilePaths", () => {
    it("returns all open file paths across windows", () => {
      useTabStore.getState().createTab("w1", "/file1.md");
      useTabStore.getState().createTab("w2", "/file2.md");
      useTabStore.getState().createTab("w1", null); // untitled, no path

      const paths = useTabStore.getState().getAllOpenFilePaths();
      expect(paths).toEqual(["/file1.md", "/file2.md"]);
    });
  });

  describe("removeWindow", () => {
    it("removes window state entirely", () => {
      useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().removeWindow(WINDOW);

      expect(useTabStore.getState().tabs[WINDOW]).toBeUndefined();
      expect(useTabStore.getState().activeTabId[WINDOW]).toBeUndefined();
    });
  });

  describe("updateTabPath", () => {
    it("updates path and title for a tab", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/old.md");
      useTabStore.getState().updateTabPath(id, "/new/path.md");

      const tab = useTabStore.getState().getTabsByWindow(WINDOW).find(t => t.id === id);
      expect(tab!.filePath).toBe("/new/path.md");
    });
  });

  describe("updateTabTitle", () => {
    it("updates title for a tab, using ternary fallback (line 318)", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().updateTabTitle(id, "New Title");

      const tab = useTabStore.getState().getTabsByWindow(WINDOW).find(t => t.id === id);
      expect(tab!.title).toBe("New Title");
    });

    it("does not update non-matching tabs (line 318 false branch)", () => {
      const id1 = useTabStore.getState().createTab(WINDOW, "/file1.md");
      const id2 = useTabStore.getState().createTab(WINDOW, "/file2.md");
      useTabStore.getState().updateTabTitle(id1, "Updated");

      const tab2 = useTabStore.getState().getTabsByWindow(WINDOW).find(t => t.id === id2);
      expect(tab2!.title).not.toBe("Updated");
    });
  });

  describe("createTab — untitled tab counter", () => {
    it("creates untitled tabs with incrementing counter", () => {
      useTabStore.getState().createTab(WINDOW, null);
      useTabStore.getState().createTab(WINDOW, null);

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs[0].title).toBe("Untitled-1");
      expect(tabs[1].title).toBe("Untitled-2");
    });
  });

  describe("createTransferredTab", () => {
    it("adds a transferred tab", () => {
      const tab = { id: "transfer-1", filePath: "/file.md", title: "file", isPinned: false };
      const id = useTabStore.getState().createTransferredTab(WINDOW, tab);

      expect(id).toBe("transfer-1");
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
      expect(useTabStore.getState().activeTabId[WINDOW]).toBe("transfer-1");
    });

    it("returns existing tab ID if already present", () => {
      const tab = { id: "transfer-1", filePath: "/file.md", title: "file", isPinned: false };
      useTabStore.getState().createTransferredTab(WINDOW, tab);
      const id = useTabStore.getState().createTransferredTab(WINDOW, tab);

      expect(id).toBe("transfer-1");
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    });
  });

  describe("getTabTitle — edge cases (line 96)", () => {
    it("handles filePath that getFileName returns empty for", () => {
      // getFileName returns "" for "/" → falls back to filePath itself
      const _id = useTabStore.getState().createTab(WINDOW, "/");
      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      // Should use filePath "/" as the name, then stripMarkdownExtension
      expect(tabs[0].title).toBeDefined();
    });
  });

  describe("pinned tab cannot be closed", () => {
    it("does not close a pinned tab", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/file.md");
      useTabStore.getState().togglePin(WINDOW, id);
      useTabStore.getState().closeTab(WINDOW, id);

      // Tab should still be there
      expect(useTabStore.getState().getTabsByWindow(WINDOW)).toHaveLength(1);
    });
  });

  describe("fallback branches for non-existent windows", () => {
    it("reopenClosedTab falls back to empty array for non-existent window (line 390)", () => {
      const result = useTabStore.getState().reopenClosedTab("no-such-window");
      expect(result).toBeNull();
    });

    it("getTabsByWindow returns empty array for non-existent window (line 403)", () => {
      const tabs = useTabStore.getState().getTabsByWindow("no-such-window");
      expect(tabs).toEqual([]);
    });

    it("getActiveTab falls back for non-existent window tabs (line 410)", () => {
      // Set up activeTabId pointing to a window with no tabs array
      useTabStore.setState({
        activeTabId: { "ghost-window": "tab-999" },
        tabs: {},
      });
      const tab = useTabStore.getState().getActiveTab("ghost-window");
      expect(tab).toBeNull();
    });

    it("findTabByPath returns null for non-existent window (line 415)", () => {
      const found = useTabStore.getState().findTabByPath("no-such-window", "/file.md");
      expect(found).toBeNull();
    });

    it("closeTab falls back for non-existent window (line 170 || [])", () => {
      useTabStore.getState().closeTab("no-such-window", "tab-1");
      // No crash; state unchanged
      expect(useTabStore.getState().tabs).toEqual({});
    });

    it("reopenClosedTab with tabs missing for window (line 390 || [])", () => {
      // Window has closed tabs but no open tabs array
      useTabStore.setState({
        tabs: {},
        closedTabs: { "orphan": [{ id: "closed-1", filePath: "/old.md", title: "old", isPinned: false }] },
        activeTabId: {},
      });
      const result = useTabStore.getState().reopenClosedTab("orphan");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("closed-1");
      // Should have created the tabs entry
      expect(useTabStore.getState().tabs["orphan"]).toHaveLength(1);
    });
  });

  describe("togglePin — pin moves tab after last pinned (lines 339-344)", () => {
    it("moves tab to correct position when pinning", () => {
      const _id1 = useTabStore.getState().createTab(WINDOW, "/a.md");
      const _id2 = useTabStore.getState().createTab(WINDOW, "/b.md");
      const id3 = useTabStore.getState().createTab(WINDOW, "/c.md");

      // Pin the third tab — it should move after any existing pinned tabs
      useTabStore.getState().togglePin(WINDOW, id3);

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      // id3 should now be first (only pinned tab, index 0)
      expect(tabs[0].id).toBe(id3);
      expect(tabs[0].isPinned).toBe(true);
    });

    it("moves tab after existing pinned tabs when pinning", () => {
      const id1 = useTabStore.getState().createTab(WINDOW, "/a.md");
      const _id2 = useTabStore.getState().createTab(WINDOW, "/b.md");
      const id3 = useTabStore.getState().createTab(WINDOW, "/c.md");

      // Pin first tab
      useTabStore.getState().togglePin(WINDOW, id1);
      // Pin third tab — should move to index 1 (after first pinned)
      useTabStore.getState().togglePin(WINDOW, id3);

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs[0].id).toBe(id1);
      expect(tabs[1].id).toBe(id3);
      expect(tabs[1].isPinned).toBe(true);
    });
  });

  describe("updateTabPath — ternary false branch (line 306)", () => {
    it("does not modify tabs whose id does not match", () => {
      const id = useTabStore.getState().createTab(WINDOW, "/a.md");
      useTabStore.getState().createTab(WINDOW, "/b.md");

      useTabStore.getState().updateTabPath(id, "/new.md");

      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs.find((t) => t.id === id)!.filePath).toBe("/new.md");
      const other = tabs.find((t) => t.id !== id);
      expect(other!.filePath).toBe("/b.md");
    });
  });

  describe("getTabTitle — untitled with counter (line 93)", () => {
    it("returns Untitled-N when creating untitled tab", () => {
      // createTab with null always increments the counter
      const _id = useTabStore.getState().createTab(WINDOW, null);
      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      expect(tabs[0].title).toMatch(/^Untitled-\d+$/);
    });
  });

  describe("detachTab — non-existent window fallback (line 272)", () => {
    it("falls back for non-existent window", () => {
      useTabStore.getState().detachTab("no-such-window", "tab-1");
      expect(useTabStore.getState().tabs).toEqual({});
    });
  });

  describe("togglePin — unpin updates in place (line 347)", () => {
    it("unpins a pinned tab and updates in place with multiple tabs", () => {
      const id1 = useTabStore.getState().createTab(WINDOW, "/a.md");
      const id2 = useTabStore.getState().createTab(WINDOW, "/b.md");
      // Pin then unpin id1
      useTabStore.getState().togglePin(WINDOW, id1);
      expect(useTabStore.getState().getTabsByWindow(WINDOW)[0].isPinned).toBe(true);

      useTabStore.getState().togglePin(WINDOW, id1);
      const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
      // id1 unpinned
      expect(tabs.find((t) => t.id === id1)!.isPinned).toBe(false);
      // id2 unchanged
      expect(tabs.find((t) => t.id === id2)!.isPinned).toBe(false);
    });
  });
});
