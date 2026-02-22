/**
 * Tests for tabHandlers — tabs.list, tabs.switch, tabs.close,
 * tabs.create, tabs.getInfo, tabs.reopenClosed.
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
        error: "tabId is required",
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
  });
});
