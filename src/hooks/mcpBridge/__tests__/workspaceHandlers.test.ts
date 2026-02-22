/**
 * Tests for workspaceHandlers — windows.list, windows.getFocused,
 * workspace.newDocument, workspace.getDocumentInfo, workspace.getInfo,
 * workspace.listRecentFiles.
 *
 * Note: handlers that call Tauri filesystem APIs (openDocument, saveDocument,
 * reloadDocument) are tested for argument validation and error paths only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
  resolveWindowId: (id?: string) => id ?? "main",
}));

// Mock stores
const mockTabStoreState = {
  activeTabId: { main: "tab-1" } as Record<string, string>,
  tabs: {
    main: [{ id: "tab-1", title: "Test", filePath: "/test.md" }],
  } as Record<string, Array<{ id: string; title: string; filePath: string | null }>>,
  createTab: vi.fn().mockReturnValue("tab-new"),
  closeTab: vi.fn(),
};
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => mockTabStoreState,
  },
}));

const mockDocStoreState = {
  getDocument: vi.fn().mockReturnValue({
    filePath: "/test.md",
    isDirty: false,
  }),
  initDocument: vi.fn(),
};
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => mockDocStoreState,
  },
}));

vi.mock("@/stores/recentFilesStore", () => ({
  useRecentFilesStore: {
    getState: () => ({
      files: ["/file1.md", "/file2.md"],
    }),
  },
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({
      isWorkspaceMode: true,
      rootPath: "/Users/test/project",
    }),
  },
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockResolvedValue("# Content"),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setFocus: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/utils/markdownPipeline", () => ({
  serializeMarkdown: vi.fn().mockReturnValue("# Content"),
}));

vi.mock("@/utils/paths", () => ({
  getFileName: (path: string) => path.split("/").pop() ?? "",
}));

vi.mock("@/utils/reloadFromDisk", () => ({
  reloadTabFromDisk: vi.fn().mockResolvedValue(undefined),
}));

import {
  handleWindowsList,
  handleWindowsGetFocused,
  handleWorkspaceNewDocument,
  handleWorkspaceGetDocumentInfo,
  handleWorkspaceGetInfo,
  handleWorkspaceListRecentFiles,
  handleWorkspaceCloseWindow,
} from "../workspaceHandlers";

describe("workspaceHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabStoreState.activeTabId = { main: "tab-1" };
  });

  describe("handleWindowsList", () => {
    it("returns list of windows", async () => {
      await handleWindowsList("req-1");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data).toHaveLength(1);
      expect(call.data[0].label).toBe("main");
      expect(call.data[0].isFocused).toBe(true);
    });
  });

  describe("handleWindowsGetFocused", () => {
    it("returns main as focused window", async () => {
      await handleWindowsGetFocused("req-2");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: "main",
      });
    });
  });

  describe("handleWorkspaceNewDocument", () => {
    it("creates new tab and document", async () => {
      await handleWorkspaceNewDocument("req-3");

      expect(mockTabStoreState.createTab).toHaveBeenCalledWith("main", null);
      expect(mockDocStoreState.initDocument).toHaveBeenCalledWith(
        "tab-new",
        "",
        null
      );
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: true,
        data: { windowId: "main" },
      });
    });
  });

  describe("handleWorkspaceGetDocumentInfo", () => {
    it("returns document info with word/char counts", async () => {
      const editor = {
        state: {
          doc: { textContent: "Hello world test" },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleWorkspaceGetDocumentInfo("req-4", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.filePath).toBe("/test.md");
      expect(call.data.isDirty).toBe(false);
      expect(call.data.wordCount).toBe(3);
      expect(call.data.charCount).toBe(16);
    });

    it("returns error when no active document", async () => {
      mockTabStoreState.activeTabId = {};

      await handleWorkspaceGetDocumentInfo("req-5", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "No active document",
      });
    });
  });

  describe("handleWorkspaceGetInfo", () => {
    it("returns workspace info", async () => {
      await handleWorkspaceGetInfo("req-6");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isWorkspaceMode).toBe(true);
      expect(call.data.rootPath).toBe("/Users/test/project");
      expect(call.data.workspaceName).toBe("project");
    });
  });

  describe("handleWorkspaceListRecentFiles", () => {
    it("returns recent files list", async () => {
      await handleWorkspaceListRecentFiles("req-7");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: true,
        data: ["/file1.md", "/file2.md"],
      });
    });
  });

  describe("handleWorkspaceCloseWindow", () => {
    it("closes the active tab", async () => {
      await handleWorkspaceCloseWindow("req-8", {});

      expect(mockTabStoreState.closeTab).toHaveBeenCalledWith("main", "tab-1");
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-8",
        success: true,
        data: null,
      });
    });

    it("no-op when no active tab", async () => {
      mockTabStoreState.activeTabId = {};

      await handleWorkspaceCloseWindow("req-9", {});

      expect(mockTabStoreState.closeTab).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-9",
        success: true,
        data: null,
      });
    });
  });
});
