import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "./tabStore";

function resetTabStore() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

beforeEach(resetTabStore);

describe("tabStore", () => {
  describe("tab titles", () => {
    it("strips markdown extensions from tab titles", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/docs/readme.md");
      store.createTab("main", "/docs/notes.markdown");
      store.createTab("main", "/docs/todo.txt");

      const tabs = store.getTabsByWindow("main");
      const titles = tabs.map((tab) => tab.title);

      expect(titles).toEqual(["readme", "notes", "todo"]);
    });
  });

  describe("createTab", () => {
    it("creates new tab with unique id", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/file1.md");
      const id2 = store.createTab("main", "/file2.md");

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^tab-/);
      expect(id2).toMatch(/^tab-/);
    });

    it("increments untitled counter for new files", () => {
      const store = useTabStore.getState();

      store.createTab("main", null);
      store.createTab("main", null);
      store.createTab("main", null);

      const tabs = store.getTabsByWindow("main");
      const titles = tabs.map((t) => t.title);

      expect(titles).toEqual(["Untitled-1", "Untitled-2", "Untitled-3"]);
    });

    it("deduplicates by file path", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/docs/file.md");
      const id2 = store.createTab("main", "/docs/file.md");

      expect(id1).toBe(id2);
      expect(store.getTabsByWindow("main")).toHaveLength(1);
    });

    it("allows same file in different windows", () => {
      const store = useTabStore.getState();

      store.createTab("window1", "/docs/file.md");
      store.createTab("window2", "/docs/file.md");

      expect(store.getTabsByWindow("window1")).toHaveLength(1);
      expect(store.getTabsByWindow("window2")).toHaveLength(1);
    });

    it("sets active tab to newly created tab", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", "/file.md");

      expect(store.getActiveTab("main")?.id).toBe(id);
    });

    it("activates existing tab when opening duplicate", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");
      const id3 = store.createTab("main", "/file1.md");

      expect(id3).toBe(id1);
      expect(store.getActiveTab("main")?.id).toBe(id1);
    });

    it("creates untitled tab with correct title", () => {
      const store = useTabStore.getState();

      store.createTab("main", null);

      const tab = store.getActiveTab("main");
      expect(tab?.title).toBe("Untitled-1");
      expect(tab?.filePath).toBeNull();
    });
  });

  describe("createTransferredTab", () => {
    it("inserts tab with provided id and activates it", () => {
      const store = useTabStore.getState();
      store.createTransferredTab("main", {
        id: "tab-transfer-1",
        filePath: "/docs/moved.md",
        title: "moved",
        isPinned: false,
      });

      const tabs = store.getTabsByWindow("main");
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe("tab-transfer-1");
      expect(store.getActiveTab("main")?.id).toBe("tab-transfer-1");
    });

    it("does not duplicate existing transfer id", () => {
      const store = useTabStore.getState();
      store.createTransferredTab("main", {
        id: "tab-transfer-1",
        filePath: "/docs/moved.md",
        title: "moved",
        isPinned: false,
      });
      store.createTransferredTab("main", {
        id: "tab-transfer-1",
        filePath: "/docs/other.md",
        title: "other",
        isPinned: false,
      });

      const tabs = store.getTabsByWindow("main");
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe("/docs/moved.md");
    });
  });

  describe("closeTab", () => {
    it("cannot close pinned tabs", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", "/file.md");
      store.togglePin("main", id);
      store.closeTab("main", id);

      expect(store.getTabsByWindow("main")).toHaveLength(1);
    });

    it("selects adjacent tab after close (prefer right)", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      const id2 = store.createTab("main", "/file2.md");
      const id3 = store.createTab("main", "/file3.md");

      store.setActiveTab("main", id2);
      store.closeTab("main", id2);

      // Should select id3 (right neighbor)
      expect(store.getActiveTab("main")?.id).toBe(id3);
    });

    it("selects left tab when closing rightmost tab", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      const id2 = store.createTab("main", "/file2.md");
      const id3 = store.createTab("main", "/file3.md");

      store.setActiveTab("main", id3);
      store.closeTab("main", id3);

      expect(store.getActiveTab("main")?.id).toBe(id2);
    });

    it("adds to closed tabs history", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", "/file.md");
      store.createTab("main", "/file2.md"); // Need another tab to close first one
      store.closeTab("main", id);

      const state = useTabStore.getState();
      expect(state.closedTabs["main"]).toHaveLength(1);
      expect(state.closedTabs["main"][0].filePath).toBe("/file.md");
    });

    it("limits closed history to 10 items", () => {
      const store = useTabStore.getState();

      // Create 12 tabs
      for (let i = 0; i < 12; i++) {
        store.createTab("main", `/file${i}.md`);
      }

      // Close 11 of them (keep one to have something to activate)
      const tabs = store.getTabsByWindow("main");
      for (let i = 0; i < 11; i++) {
        store.closeTab("main", tabs[i].id);
      }

      const state = useTabStore.getState();
      expect(state.closedTabs["main"]).toHaveLength(10);
    });

    it("sets active to null when closing last tab", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", "/file.md");
      store.closeTab("main", id);

      expect(store.getActiveTab("main")).toBeNull();
    });

    it("does nothing for non-existent tab", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file.md");
      store.closeTab("main", "non-existent-id");

      expect(store.getTabsByWindow("main")).toHaveLength(1);
    });
  });

  describe("togglePin", () => {
    it("pins an unpinned tab", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", "/file.md");
      store.togglePin("main", id);

      const tab = store.findTabByPath("main", "/file.md");
      expect(tab?.isPinned).toBe(true);
    });

    it("unpins a pinned tab", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", "/file.md");
      store.togglePin("main", id);
      store.togglePin("main", id);

      const tab = store.findTabByPath("main", "/file.md");
      expect(tab?.isPinned).toBe(false);
    });

    it("moves pinned tabs to front", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");
      const id3 = store.createTab("main", "/file3.md");

      store.togglePin("main", id3);

      const tabs = store.getTabsByWindow("main");
      expect(tabs[0].filePath).toBe("/file3.md");
      expect(tabs[0].isPinned).toBe(true);
    });

    it("maintains order within pinned tabs", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      const id2 = store.createTab("main", "/file2.md");
      const id3 = store.createTab("main", "/file3.md");
      store.createTab("main", "/file4.md");

      store.togglePin("main", id3);
      store.togglePin("main", id2);

      const tabs = store.getTabsByWindow("main");
      // Pinned tabs should be at front in order they were pinned
      expect(tabs[0].filePath).toBe("/file3.md");
      expect(tabs[1].filePath).toBe("/file2.md");
      expect(tabs[0].isPinned).toBe(true);
      expect(tabs[1].isPinned).toBe(true);
    });

    it("does nothing for non-existent tab", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file.md");
      store.togglePin("main", "non-existent-id");

      const tabs = store.getTabsByWindow("main");
      expect(tabs[0].isPinned).toBe(false);
    });
  });

  describe("reopenClosedTab", () => {
    it("reopens most recently closed tab", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");
      store.closeTab("main", id1);

      const reopened = store.reopenClosedTab("main");

      expect(reopened?.filePath).toBe("/file1.md");
    });

    it("removes from closed history", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");
      store.closeTab("main", id1);

      store.reopenClosedTab("main");

      const state = useTabStore.getState();
      expect(state.closedTabs["main"]).toHaveLength(0);
    });

    it("returns null when history empty", () => {
      const store = useTabStore.getState();

      const result = store.reopenClosedTab("main");

      expect(result).toBeNull();
    });

    it("activates reopened tab", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");
      store.closeTab("main", id1);

      const reopened = store.reopenClosedTab("main");

      expect(store.getActiveTab("main")?.id).toBe(reopened?.id);
    });

    it("reopens tabs in LIFO order", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/file1.md");
      const id2 = store.createTab("main", "/file2.md");
      store.createTab("main", "/file3.md");

      store.closeTab("main", id1);
      store.closeTab("main", id2);

      const first = store.reopenClosedTab("main");
      const second = store.reopenClosedTab("main");

      expect(first?.filePath).toBe("/file2.md");
      expect(second?.filePath).toBe("/file1.md");
    });
  });

  describe("reorderTabs", () => {
    it("moves tab from one position to another", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");
      store.createTab("main", "/file3.md");

      store.reorderTabs("main", 0, 2);

      const tabs = store.getTabsByWindow("main");
      const filePaths = tabs.map((t) => t.filePath);
      expect(filePaths).toEqual(["/file2.md", "/file3.md", "/file1.md"]);
    });

    it("does nothing for invalid fromIndex", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");

      store.reorderTabs("main", -1, 1);
      store.reorderTabs("main", 5, 1);

      const tabs = store.getTabsByWindow("main");
      expect(tabs.map((t) => t.filePath)).toEqual(["/file1.md", "/file2.md"]);
    });

    it("does nothing for invalid toIndex", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");

      store.reorderTabs("main", 0, -1);
      store.reorderTabs("main", 0, 5);

      const tabs = store.getTabsByWindow("main");
      expect(tabs.map((t) => t.filePath)).toEqual(["/file1.md", "/file2.md"]);
    });
  });

  describe("getAllOpenFilePaths", () => {
    it("returns all file paths across windows", () => {
      const store = useTabStore.getState();

      store.createTab("window1", "/file1.md");
      store.createTab("window1", "/file2.md");
      store.createTab("window2", "/file3.md");
      store.createTab("window2", null); // Untitled

      const paths = store.getAllOpenFilePaths();

      expect(paths).toContain("/file1.md");
      expect(paths).toContain("/file2.md");
      expect(paths).toContain("/file3.md");
      expect(paths).toHaveLength(3); // Untitled not included
    });

    it("returns empty array when no tabs", () => {
      const store = useTabStore.getState();

      const paths = store.getAllOpenFilePaths();

      expect(paths).toEqual([]);
    });
  });

  describe("updateTabPath", () => {
    it("updates file path and title", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", null);
      store.updateTabPath(id, "/saved-file.md");

      const tab = store.getActiveTab("main");
      expect(tab?.filePath).toBe("/saved-file.md");
      expect(tab?.title).toBe("saved-file");
    });

    it("updates tab across windows", () => {
      const store = useTabStore.getState();

      const id = store.createTab("window1", "/old-path.md");
      store.updateTabPath(id, "/new-path.md");

      const tab = store.findTabByPath("window1", "/new-path.md");
      expect(tab).not.toBeNull();
    });
  });

  describe("updateTabTitle", () => {
    it("updates title without changing path", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", "/file.md");
      store.updateTabTitle(id, "Custom Title");

      const tab = store.getActiveTab("main");
      expect(tab?.title).toBe("Custom Title");
      expect(tab?.filePath).toBe("/file.md");
    });
  });

  describe("removeWindow", () => {
    it("removes all data for window", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");
      const id = store.createTab("main", "/file3.md");
      store.closeTab("main", id);

      store.removeWindow("main");

      const state = useTabStore.getState();
      expect(state.tabs["main"]).toBeUndefined();
      expect(state.activeTabId["main"]).toBeUndefined();
      expect(state.closedTabs["main"]).toBeUndefined();
    });

    it("does not affect other windows", () => {
      const store = useTabStore.getState();

      store.createTab("window1", "/file1.md");
      store.createTab("window2", "/file2.md");

      store.removeWindow("window1");

      expect(store.getTabsByWindow("window2")).toHaveLength(1);
    });
  });

  describe("setActiveTab", () => {
    it("sets active tab", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");

      store.setActiveTab("main", id1);

      expect(store.getActiveTab("main")?.id).toBe(id1);
    });
  });

  describe("getTabsByWindow", () => {
    it("returns empty array for non-existent window", () => {
      const store = useTabStore.getState();

      const tabs = store.getTabsByWindow("nonexistent");

      expect(tabs).toEqual([]);
    });
  });

  describe("getActiveTab", () => {
    it("returns null for non-existent window", () => {
      const store = useTabStore.getState();

      const tab = store.getActiveTab("nonexistent");

      expect(tab).toBeNull();
    });

    it("returns null when no active tab", () => {
      const store = useTabStore.getState();

      useTabStore.setState({
        tabs: { main: [] },
        activeTabId: { main: null },
      });

      const tab = store.getActiveTab("main");

      expect(tab).toBeNull();
    });
  });

  describe("findTabByPath", () => {
    it("returns null when tab not found", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");

      const tab = store.findTabByPath("main", "/nonexistent.md");

      expect(tab).toBeNull();
    });
  });

  describe("detachTab", () => {
    it("removes tab without adding to closed history", () => {
      const store = useTabStore.getState();

      const id1 = store.createTab("main", "/file1.md");
      store.createTab("main", "/file2.md");

      store.detachTab("main", id1);

      expect(store.getTabsByWindow("main")).toHaveLength(1);
      const state = useTabStore.getState();
      expect(state.closedTabs["main"] ?? []).toHaveLength(0);
    });

    it("activates adjacent tab when detaching active tab", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      const id2 = store.createTab("main", "/file2.md");
      const id3 = store.createTab("main", "/file3.md");

      store.setActiveTab("main", id2);
      store.detachTab("main", id2);

      expect(store.getActiveTab("main")?.id).toBe(id3);
    });

    it("sets active to null when detaching the last tab", () => {
      const store = useTabStore.getState();

      const id = store.createTab("main", "/file.md");
      store.detachTab("main", id);

      expect(store.getActiveTab("main")).toBeNull();
    });

    it("does nothing for non-existent tab", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      store.detachTab("main", "non-existent-id");

      expect(store.getTabsByWindow("main")).toHaveLength(1);
    });

    it("does not change active tab when detaching non-active tab", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      const id2 = store.createTab("main", "/file2.md");
      const id3 = store.createTab("main", "/file3.md");

      store.setActiveTab("main", id3);
      store.detachTab("main", id2);

      expect(store.getActiveTab("main")?.id).toBe(id3);
    });

    it("selects left tab when detaching rightmost active tab", () => {
      const store = useTabStore.getState();

      store.createTab("main", "/file1.md");
      const id2 = store.createTab("main", "/file2.md");
      const id3 = store.createTab("main", "/file3.md");

      store.setActiveTab("main", id3);
      store.detachTab("main", id3);

      expect(store.getActiveTab("main")?.id).toBe(id2);
    });
  });

});
