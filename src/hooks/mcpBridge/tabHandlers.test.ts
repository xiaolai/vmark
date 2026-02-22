/**
 * MCP Bridge — Tab Handler Tests
 *
 * Tests for tabs.list, tabs.switch, tabs.close, tabs.create,
 * tabs.getInfo, and tabs.reopenClosed handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleTabsList,
  handleTabsSwitch,
  handleTabsClose,
  handleTabsCreate,
  handleTabsGetInfo,
  handleTabsReopenClosed,
} from "./tabHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  resolveWindowId: vi.fn((id?: string) => id ?? "main"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(() => Promise.resolve("file content")),
}));

const mockTabStore = {
  tabs: { main: [{ id: "tab-1", title: "Doc 1", filePath: "/doc1.md" }] },
  activeTabId: { main: "tab-1" },
  setActiveTab: vi.fn(),
  closeTab: vi.fn(),
  createTab: vi.fn(() => "tab-new"),
  reopenClosedTab: vi.fn(() => null),
};

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(() => mockTabStore),
  },
}));

const mockDocStore = {
  getDocument: vi.fn(() => ({ filePath: "/doc1.md", isDirty: false })),
  initDocument: vi.fn(),
};

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => mockDocStore),
  },
}));

import { respond } from "./utils";

describe("tabHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to defaults
    mockTabStore.tabs = { main: [{ id: "tab-1", title: "Doc 1", filePath: "/doc1.md" }] };
    mockTabStore.activeTabId = { main: "tab-1" };
    mockTabStore.reopenClosedTab.mockReturnValue(null);
    mockDocStore.getDocument.mockReturnValue({ filePath: "/doc1.md", isDirty: false });
  });

  describe("handleTabsList", () => {
    it("returns list of tabs", async () => {
      await handleTabsList("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: [
          expect.objectContaining({
            id: "tab-1",
            title: "Doc 1",
            filePath: "/doc1.md",
            isActive: true,
          }),
        ],
      });
    });

    it("returns empty array when no tabs", async () => {
      mockTabStore.tabs = { main: [] };

      await handleTabsList("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: [],
      });
    });
  });

  describe("handleTabsSwitch", () => {
    it("switches to specified tab", async () => {
      await handleTabsSwitch("req-1", { tabId: "tab-1" });

      expect(mockTabStore.setActiveTab).toHaveBeenCalledWith("main", "tab-1");
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when tabId missing", async () => {
      await handleTabsSwitch("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "tabId is required",
      });
    });

    it("returns error when tab not found", async () => {
      await handleTabsSwitch("req-1", { tabId: "nonexistent" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Tab not found: nonexistent",
      });
    });
  });

  describe("handleTabsClose", () => {
    it("closes specified tab", async () => {
      await handleTabsClose("req-1", { tabId: "tab-1" });

      expect(mockTabStore.closeTab).toHaveBeenCalledWith("main", "tab-1");
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("closes active tab when tabId not specified", async () => {
      await handleTabsClose("req-1", {});

      expect(mockTabStore.closeTab).toHaveBeenCalledWith("main", "tab-1");
    });

    it("returns error when no tab to close", async () => {
      mockTabStore.activeTabId = { main: undefined as unknown as string };

      await handleTabsClose("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No tab to close",
      });
    });
  });

  describe("handleTabsCreate", () => {
    it("creates new empty tab", async () => {
      await handleTabsCreate("req-1", {});

      expect(mockTabStore.createTab).toHaveBeenCalledWith("main", null);
      expect(mockDocStore.initDocument).toHaveBeenCalledWith("tab-new", "", null);
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { tabId: "tab-new" },
      });
    });
  });

  describe("handleTabsGetInfo", () => {
    it("returns tab info for specified tab", async () => {
      await handleTabsGetInfo("req-1", { tabId: "tab-1" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          id: "tab-1",
          title: "Doc 1",
          filePath: "/doc1.md",
        }),
      });
    });

    it("returns error for non-existent tab", async () => {
      await handleTabsGetInfo("req-1", { tabId: "missing" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Tab not found: missing",
      });
    });

    it("returns error when no tab specified and no active tab", async () => {
      mockTabStore.activeTabId = { main: undefined as unknown as string };

      await handleTabsGetInfo("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No tab specified and no active tab",
      });
    });
  });

  describe("handleTabsReopenClosed", () => {
    it("returns null when no closed tabs", async () => {
      mockTabStore.reopenClosedTab.mockReturnValue(null);

      await handleTabsReopenClosed("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: null,
      });
    });

    it("reopens closed tab and initializes document", async () => {
      mockTabStore.reopenClosedTab.mockReturnValue({
        id: "tab-reopened",
        title: "Old Doc",
        filePath: "/old.md",
      });

      await handleTabsReopenClosed("req-1", {});

      expect(mockDocStore.initDocument).toHaveBeenCalledWith(
        "tab-reopened",
        "file content",
        "/old.md",
      );
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          tabId: "tab-reopened",
          filePath: "/old.md",
          title: "Old Doc",
        },
      });
    });

    it("initializes empty content for untitled reopened tab", async () => {
      mockTabStore.reopenClosedTab.mockReturnValue({
        id: "tab-reopened",
        title: "Untitled",
        filePath: null,
      });

      await handleTabsReopenClosed("req-1", {});

      expect(mockDocStore.initDocument).toHaveBeenCalledWith("tab-reopened", "", null);
    });
  });
});
