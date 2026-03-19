/**
 * Tests for tabHandlers — tabs.list, tabs.getActive, tabs.switch,
 * tabs.close, tabs.create, tabs.getInfo, tabs.reopenClosed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  resolveWindowId: (id?: string) => id ?? "main",
}));

// Mutable store state for tests
const mockTabs = [
  { id: "tab-1", title: "Doc 1", filePath: "/doc1.md" },
  { id: "tab-2", title: "Doc 2", filePath: null },
];
const mockTabStoreState = {
  activeTabId: { main: "tab-1" } as Record<string, string>,
  tabs: { main: mockTabs } as Record<string, typeof mockTabs>,
  setActiveTab: vi.fn(),
  closeTab: vi.fn(),
  createTab: vi.fn().mockReturnValue("tab-new"),
  reopenClosedTab: vi.fn(),
  updateTabPath: vi.fn(),
  updateTabTitle: vi.fn(),
};
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => mockTabStoreState,
  },
}));

const mockDocStoreState = {
  getDocument: vi.fn().mockReturnValue({ isDirty: false }),
  initDocument: vi.fn(),
};
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => mockDocStoreState,
  },
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockResolvedValue("file content"),
}));

import {
  handleTabsList,
  handleTabsGetActive,
  handleTabsSwitch,
  handleTabsClose,
  handleTabsCreate,
  handleTabsGetInfo,
  handleTabsReopenClosed,
} from "../tabHandlers";

describe("tabHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabStoreState.activeTabId = { main: "tab-1" };
  });

  describe("handleTabsList", () => {
    it("lists all tabs with active flag", async () => {
      await handleTabsList("req-1", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data).toHaveLength(2);
      expect(call.data[0].isActive).toBe(true);
      expect(call.data[1].isActive).toBe(false);
    });

    it("returns empty array for unknown window", async () => {
      await handleTabsList("req-2", { windowId: "unknown" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data).toHaveLength(0);
    });
  });

  describe("handleTabsGetActive", () => {
    it("returns active tab info", async () => {
      await handleTabsGetActive("req-ga-1", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.id).toBe("tab-1");
      expect(call.data.title).toBe("Doc 1");
      expect(call.data.isActive).toBe(true);
    });

    it("returns null when no active tab", async () => {
      mockTabStoreState.activeTabId = {};

      await handleTabsGetActive("req-ga-2", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ga-2",
        success: true,
        data: null,
      });
    });

    it("returns null when active tab ID not found in tabs array", async () => {
      mockTabStoreState.activeTabId = { main: "tab-nonexistent" };

      await handleTabsGetActive("req-ga-3", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ga-3",
        success: true,
        data: null,
      });
    });

    it("handles non-Error thrown value", async () => {
      const origTabs = mockTabStoreState.tabs;
      Object.defineProperty(mockTabStoreState, "tabs", {
        get: () => { throw "getActive error"; },
        configurable: true,
      });

      await handleTabsGetActive("req-ga-err", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ga-err",
        success: false,
        error: "getActive error",
      });

      Object.defineProperty(mockTabStoreState, "tabs", {
        value: origTabs,
        writable: true,
        configurable: true,
      });
    });
  });

  describe("handleTabsSwitch", () => {
    it("switches to specified tab", async () => {
      await handleTabsSwitch("req-3", { tabId: "tab-2" });

      expect(mockTabStoreState.setActiveTab).toHaveBeenCalledWith("main", "tab-2");
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: true,
        data: null,
      });
    });

    it("returns error for missing tabId", async () => {
      await handleTabsSwitch("req-4", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-4",
        success: false,
        error: "Missing or invalid 'tabId' (expected string, got undefined)",
      });
    });

    it("returns error for wrong-type tabId", async () => {
      await handleTabsSwitch("req-4b", { tabId: 123 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-4b",
        success: false,
        error: "Missing or invalid 'tabId' (expected string, got number)",
      });
    });

    it("returns error for non-existent tab", async () => {
      await handleTabsSwitch("req-5", { tabId: "tab-nonexistent" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "Tab not found: tab-nonexistent",
      });
    });
  });

  describe("handleTabsClose", () => {
    it("closes specified tab", async () => {
      await handleTabsClose("req-6", { tabId: "tab-1" });

      expect(mockTabStoreState.closeTab).toHaveBeenCalledWith("main", "tab-1");
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-6",
        success: true,
        data: null,
      });
    });

    it("closes active tab when no tabId specified", async () => {
      await handleTabsClose("req-7", {});

      expect(mockTabStoreState.closeTab).toHaveBeenCalledWith("main", "tab-1");
    });

    it("returns error when no tab to close", async () => {
      mockTabStoreState.activeTabId = {};

      await handleTabsClose("req-8", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-8",
        success: false,
        error: "No tab to close",
      });
    });
  });

  describe("handleTabsCreate", () => {
    it("creates new empty tab", async () => {
      await handleTabsCreate("req-9", {});

      expect(mockTabStoreState.createTab).toHaveBeenCalledWith("main", null);
      expect(mockDocStoreState.initDocument).toHaveBeenCalledWith("tab-new", "", null);
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-9",
        success: true,
        data: { tabId: "tab-new" },
      });
    });
  });

  describe("handleTabsGetInfo", () => {
    it("returns info for specified tab", async () => {
      await handleTabsGetInfo("req-10", { tabId: "tab-1" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.id).toBe("tab-1");
      expect(call.data.title).toBe("Doc 1");
      expect(call.data.filePath).toBe("/doc1.md");
    });

    it("returns info for active tab when no tabId", async () => {
      await handleTabsGetInfo("req-11", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.id).toBe("tab-1");
    });

    it("returns error for non-existent tab", async () => {
      await handleTabsGetInfo("req-12", { tabId: "tab-nonexistent" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-12",
        success: false,
        error: "Tab not found: tab-nonexistent",
      });
    });

    it("returns error when no active tab and no tabId", async () => {
      mockTabStoreState.activeTabId = {};

      await handleTabsGetInfo("req-13", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-13",
        success: false,
        error: "No tab specified and no active tab",
      });
    });
  });

  describe("handleTabsReopenClosed", () => {
    it("returns null data when no closed tabs", async () => {
      mockTabStoreState.reopenClosedTab.mockReturnValue(null);

      await handleTabsReopenClosed("req-14", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-14",
        success: true,
        data: null,
      });
    });

    it("reopens a closed tab with file path", async () => {
      mockTabStoreState.reopenClosedTab.mockReturnValue({
        id: "tab-reopened",
        filePath: "/reopened.md",
        title: "Reopened",
      });

      await handleTabsReopenClosed("req-15", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.tabId).toBe("tab-reopened");
      expect(call.data.filePath).toBe("/reopened.md");
    });

    it("reopens a closed tab without file path (untitled)", async () => {
      mockTabStoreState.reopenClosedTab.mockReturnValue({
        id: "tab-untitled",
        filePath: null,
        title: "Untitled",
      });

      await handleTabsReopenClosed("req-16", {});

      expect(mockDocStoreState.initDocument).toHaveBeenCalledWith("tab-untitled", "", null);
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.tabId).toBe("tab-untitled");
    });

    it("handles file read failure for reopened tab", async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockRejectedValueOnce(new Error("file deleted"));
      mockTabStoreState.reopenClosedTab.mockReturnValue({
        id: "tab-deleted",
        filePath: "/deleted.md",
        title: "Deleted",
      });

      await handleTabsReopenClosed("req-17", {});

      // Should init with empty content since file was deleted
      expect(mockDocStoreState.initDocument).toHaveBeenCalledWith("tab-deleted", "", "/deleted.md");
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });
  });

  describe("handleTabsCreate — error path (line 148)", () => {
    it("returns error when createTab throws", async () => {
      mockTabStoreState.createTab.mockImplementationOnce(() => {
        throw new Error("create failed");
      });

      await handleTabsCreate("req-err-create", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-create",
        success: false,
        error: "create failed",
      });
    });
  });

  describe("handleTabsReopenClosed — error path (line 252)", () => {
    it("returns error when reopenClosedTab throws", async () => {
      mockTabStoreState.reopenClosedTab.mockImplementationOnce(() => {
        throw new Error("reopen failed");
      });

      await handleTabsReopenClosed("req-err-reopen", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-reopen",
        success: false,
        error: "reopen failed",
      });
    });
  });

  describe("handleTabsList — error path", () => {
    it("returns error on exception", async () => {
      // Force tabs getter to throw
      const origTabs = mockTabStoreState.tabs;
      Object.defineProperty(mockTabStoreState, "tabs", {
        get: () => { throw new Error("store error"); },
        configurable: true,
      });

      await handleTabsList("req-err", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err",
        success: false,
        error: "store error",
      });

      // Restore
      Object.defineProperty(mockTabStoreState, "tabs", {
        value: origTabs,
        writable: true,
        configurable: true,
      });
    });

    it("handles non-Error thrown value (String(error) branch)", async () => {
      const origTabs = mockTabStoreState.tabs;
      Object.defineProperty(mockTabStoreState, "tabs", {
        get: () => { throw "string throw"; },
        configurable: true,
      });

      await handleTabsList("req-err-ne", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-ne",
        success: false,
        error: "string throw",
      });

      Object.defineProperty(mockTabStoreState, "tabs", {
        value: origTabs,
        writable: true,
        configurable: true,
      });
    });
  });

  describe("handleTabsSwitch — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockTabStoreState.setActiveTab.mockImplementationOnce(() => {
        throw 42;
      });

      await handleTabsSwitch("req-ne-sw", { tabId: "tab-1" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-sw",
        success: false,
        error: "42",
      });
    });
  });

  describe("handleTabsClose — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockTabStoreState.closeTab.mockImplementationOnce(() => {
        throw null;      });

      await handleTabsClose("req-ne-cl", { tabId: "tab-1" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-cl",
        success: false,
        error: "null",
      });
    });
  });

  describe("handleTabsCreate — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockTabStoreState.createTab.mockImplementationOnce(() => {
        throw false;      });

      await handleTabsCreate("req-ne-cr", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-cr",
        success: false,
        error: "false",
      });
    });
  });

  describe("handleTabsGetInfo — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      const origTabs = mockTabStoreState.tabs;
      Object.defineProperty(mockTabStoreState, "tabs", {
        get: () => { throw "info error"; },        configurable: true,
      });

      await handleTabsGetInfo("req-ne-gi", { tabId: "tab-1" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-gi",
        success: false,
        error: "info error",
      });

      Object.defineProperty(mockTabStoreState, "tabs", {
        value: origTabs,
        writable: true,
        configurable: true,
      });
    });
  });

  describe("handleTabsReopenClosed — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockTabStoreState.reopenClosedTab.mockImplementationOnce(() => {
        throw 0;      });

      await handleTabsReopenClosed("req-ne-ro", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-ro",
        success: false,
        error: "0",
      });
    });
  });

  describe("validated arg extraction — wrong-type windowId", () => {
    it("returns error when windowId is a number", async () => {
      await handleTabsList("req-wt-1", { windowId: 42 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-wt-1",
        success: false,
        error: "Invalid 'windowId' (expected string, got number)",
      });
    });

    it("returns error in handleTabsClose when tabId is a number", async () => {
      await handleTabsClose("req-wt-2", { tabId: 99 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-wt-2",
        success: false,
        error: "Invalid 'tabId' (expected string, got number)",
      });
    });

    it("returns error in handleTabsGetInfo when tabId is a boolean", async () => {
      await handleTabsGetInfo("req-wt-3", { tabId: true });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-wt-3",
        success: false,
        error: "Invalid 'tabId' (expected string, got boolean)",
      });
    });
  });

  describe("handleTabsSwitch — unknown windowId uses ?? [] fallback (line 81)", () => {
    it("returns error for unknown windowId (tabs[windowId] is undefined)", async () => {
      // resolveWindowId returns the windowId as-is; "unknown-window" has no tabs entry
      await handleTabsSwitch("req-sw-unk", { tabId: "tab-1", windowId: "unknown-window" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-sw-unk",
        success: false,
        error: "Tab not found: tab-1",
      });
    });
  });

  describe("handleTabsGetInfo — unknown windowId uses ?? [] fallback (line 175)", () => {
    it("returns error for unknown windowId (tabs[windowId] is undefined)", async () => {
      // tabId is provided, resolveWindowId returns "unknown-window", tabs["unknown-window"] is undefined
      await handleTabsGetInfo("req-gi-unk", { tabId: "tab-1", windowId: "unknown-window" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-gi-unk",
        success: false,
        error: "Tab not found: tab-1",
      });
    });
  });

  describe("handleTabsList — isDirty fallback to false", () => {
    it("returns isDirty false when document is not found", async () => {
      mockDocStoreState.getDocument.mockReturnValueOnce(null);

      await handleTabsList("req-dirty-null", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data[0].isDirty).toBe(false);
    });
  });

  describe("handleTabsGetInfo — isDirty fallback to false", () => {
    it("returns isDirty false when document is not found", async () => {
      mockDocStoreState.getDocument.mockReturnValueOnce(null);

      await handleTabsGetInfo("req-info-nodoc", { tabId: "tab-1" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDirty).toBe(false);
    });
  });
});
