/**
 * Tests for workspaceHandlers — windows.list, windows.getFocused,
 * workspace.newDocument, workspace.getDocumentInfo, workspace.getInfo,
 * workspace.listRecentFiles.
 *
 * Note: handlers that call Tauri filesystem APIs (openDocument, saveDocument,
 * reloadDocument) are tested for argument validation and error paths only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock workspaceStorage — must be before handler imports
vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

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
  updateTabPath: vi.fn(),
  updateTabTitle: vi.fn(),
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
  markSaved: vi.fn(),
  setFilePath: vi.fn(),
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
  handleWindowsFocus,
  handleWorkspaceNewDocument,
  handleWorkspaceOpenDocument,
  handleWorkspaceSaveDocument,
  handleWorkspaceSaveDocumentAs,
  handleWorkspaceGetDocumentInfo,
  handleWorkspaceGetInfo,
  handleWorkspaceListRecentFiles,
  handleWorkspaceCloseWindow,
  handleWorkspaceReloadDocument,
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

  describe("handleWindowsFocus", () => {
    it("returns error when windowId is missing", async () => {
      await handleWindowsFocus("req-20", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-20",
        success: false,
        error: expect.stringContaining("Missing or invalid 'windowId'"),
      });
    });

    it("focuses the current window", async () => {
      await handleWindowsFocus("req-21", { windowId: "main" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-21",
        success: true,
        data: null,
      });
    });
  });

  describe("handleWorkspaceOpenDocument", () => {
    it("returns error when path is missing", async () => {
      await handleWorkspaceOpenDocument("req-30", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-30",
        success: false,
        error: expect.stringContaining("Missing or invalid 'path'"),
      });
    });

    it("opens a document from filesystem", async () => {
      await handleWorkspaceOpenDocument("req-31", {
        path: "/test/file.md",
      });

      expect(mockTabStoreState.createTab).toHaveBeenCalledWith(
        "main",
        "/test/file.md"
      );
      expect(mockDocStoreState.initDocument).toHaveBeenCalledWith(
        "tab-new",
        "# Content",
        "/test/file.md"
      );
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-31",
        success: true,
        data: { windowId: "main" },
      });
    });
  });

  describe("handleWorkspaceSaveDocument", () => {
    it("returns error when no active document", async () => {
      mockTabStoreState.activeTabId = {};

      await handleWorkspaceSaveDocument("req-40");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-40",
        success: false,
        error: "No active document",
      });
    });

    it("returns error when document has no file path", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: null,
        isDirty: true,
        content: "content",
      });

      await handleWorkspaceSaveDocument("req-41");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-41",
        success: false,
        error: "Document has no file path (use save-as instead)",
      });
    });

    it("saves document successfully", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: true,
        content: "# Saved content",
      });

      await handleWorkspaceSaveDocument("req-42");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-42",
        success: true,
        data: null,
      });
    });
  });

  describe("handleWorkspaceSaveDocumentAs", () => {
    it("returns error when path is missing", async () => {
      await handleWorkspaceSaveDocumentAs("req-50", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-50",
        success: false,
        error: expect.stringContaining("Missing or invalid 'path'"),
      });
    });

    it("returns error when no active document", async () => {
      mockTabStoreState.activeTabId = {};

      await handleWorkspaceSaveDocumentAs("req-51", {
        path: "/new/path.md",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-51",
        success: false,
        error: "No active document",
      });
    });

    it("returns error when getDocument returns null", async () => {
      mockDocStoreState.getDocument.mockReturnValue(null);

      await handleWorkspaceSaveDocumentAs("req-52", {
        path: "/new/path.md",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-52",
        success: false,
        error: "No active document",
      });
    });
  });

  describe("handleWorkspaceSaveDocumentAs — success path", () => {
    it("saves document to new path and updates tab/doc stores", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/old/path.md",
        isDirty: true,
        content: "# Saved As Content",
      });

      await handleWorkspaceSaveDocumentAs("req-55", {
        path: "/new/path.md",
      });

      expect(mockTabStoreState.updateTabPath).toHaveBeenCalledWith("tab-1", "/new/path.md");
      expect(mockTabStoreState.updateTabTitle).toHaveBeenCalledWith("tab-1", "path.md");
      expect(mockDocStoreState.setFilePath).toHaveBeenCalledWith("tab-1", "/new/path.md");
      expect(mockDocStoreState.markSaved).toHaveBeenCalledWith("tab-1", "# Saved As Content");
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-55",
        success: true,
        data: null,
      });
    });
  });

  describe("handleWorkspaceGetInfo — edge cases", () => {
    it("returns null workspaceName when rootPath is null", async () => {
      const { useWorkspaceStore } = await import("@/stores/workspaceStore");
      const origGetState = useWorkspaceStore.getState;
      (useWorkspaceStore as unknown as { getState: () => unknown }).getState = () => ({
        isWorkspaceMode: false,
        rootPath: null,
      });

      await handleWorkspaceGetInfo("req-66");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.workspaceName).toBeNull();
      expect(call.data.rootPath).toBeNull();

      (useWorkspaceStore as unknown as { getState: typeof origGetState }).getState = origGetState;
    });

    it("returns null workspaceName when rootPath ends with /", async () => {
      const { useWorkspaceStore } = await import("@/stores/workspaceStore");
      const origGetState = useWorkspaceStore.getState;
      (useWorkspaceStore as unknown as { getState: () => unknown }).getState = () => ({
        isWorkspaceMode: true,
        rootPath: "/Users/test/project/",
      });

      await handleWorkspaceGetInfo("req-67");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // trailing slash means last segment is empty string → null
      expect(call.data.workspaceName).toBeNull();

      (useWorkspaceStore as unknown as { getState: typeof origGetState }).getState = origGetState;
    });
  });

  describe("handleWorkspaceReloadDocument", () => {
    it("returns error when no active document", async () => {
      mockTabStoreState.activeTabId = {};

      await handleWorkspaceReloadDocument("req-60", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-60",
        success: false,
        error: "No active document",
      });
    });

    it("returns error when document has no file path", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: null,
        isDirty: false,
      });

      await handleWorkspaceReloadDocument("req-61", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-61",
        success: false,
        error: "Document has no file path (untitled documents cannot be reloaded)",
      });
    });

    it("returns error when document is dirty and force is not set", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: true,
      });

      await handleWorkspaceReloadDocument("req-62", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("unsaved changes");
    });

    it("reloads when document is dirty and force=true", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: true,
      });

      await handleWorkspaceReloadDocument("req-63", { force: true });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.filePath).toBe("/test.md");
    });

    it("reloads clean document without force", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: false,
      });

      await handleWorkspaceReloadDocument("req-64", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.filePath).toBe("/test.md");
    });
  });

  describe("handleWindowsList — edge cases", () => {
    it("returns Untitled when no active tab", async () => {
      mockTabStoreState.activeTabId = {};

      await handleWindowsList("req-70");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data[0].title).toBe("Untitled");
      expect(call.data[0].filePath).toBeNull();
    });

    it("returns Untitled when doc has no filePath", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: null,
        isDirty: false,
      });

      await handleWindowsList("req-71");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data[0].title).toBe("Untitled");
    });
  });

  describe("handleWorkspaceGetDocumentInfo — edge cases", () => {
    it("returns zero counts when editor is null", async () => {
      mockGetEditor.mockReturnValue(null);
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: false,
      });

      await handleWorkspaceGetDocumentInfo("req-80", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.wordCount).toBe(0);
      expect(call.data.charCount).toBe(0);
    });

    it("returns zero word count for empty text", async () => {
      mockGetEditor.mockReturnValue({
        state: {
          doc: { textContent: "" },
        },
      });
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: false,
      });

      await handleWorkspaceGetDocumentInfo("req-81", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.wordCount).toBe(0);
      expect(call.data.charCount).toBe(0);
    });
  });

  describe("handleWorkspaceCloseWindow — error path (line 208)", () => {
    it("returns error when closeTab throws", async () => {
      mockTabStoreState.closeTab.mockImplementationOnce(() => {
        throw new Error("close window error");
      });

      await handleWorkspaceCloseWindow("req-err-close", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-close",
        success: false,
        error: "close window error",
      });
    });
  });

  describe("handleWorkspaceListRecentFiles — error path (line 328)", () => {
    it("returns error when store throws", async () => {
      // We need to make the recentFilesStore throw. Since it's mocked at module level,
      // we temporarily override by making the import throw via respond.
      // Simpler: make respond throw on first call to trigger the catch
      // Actually, we need the try block to throw. The simplest way is to mock
      // the recentFilesStore getter to throw.
      const origRecentFiles = await import("@/stores/recentFilesStore");
      const origGetState = origRecentFiles.useRecentFilesStore.getState;
      (origRecentFiles.useRecentFilesStore as unknown as Record<string, unknown>).getState = () => {
        throw new Error("recent files error");
      };

      await handleWorkspaceListRecentFiles("req-err-recent");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-recent",
        success: false,
        error: "recent files error",
      });

      // Restore
      (origRecentFiles.useRecentFilesStore as unknown as Record<string, unknown>).getState = origGetState;
    });
  });

  describe("handleWorkspaceGetInfo — error path (line 362)", () => {
    it("returns error when workspaceStore throws", async () => {
      const origWorkspace = await import("@/stores/workspaceStore");
      const origGetState = origWorkspace.useWorkspaceStore.getState;
      (origWorkspace.useWorkspaceStore as unknown as Record<string, unknown>).getState = () => {
        throw new Error("workspace info error");
      };

      await handleWorkspaceGetInfo("req-err-info");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-info",
        success: false,
        error: "workspace info error",
      });

      // Restore
      (origWorkspace.useWorkspaceStore as unknown as Record<string, unknown>).getState = origGetState;
    });
  });

  describe("error catch branches — non-Error thrown objects", () => {
    it("handleWindowsList returns String(error) for non-Error throws (line 49)", async () => {
      // Override tabStore to throw a non-Error
      const origTabStore = await import("@/stores/tabStore");
      const origGetState = origTabStore.useTabStore.getState;
      (origTabStore.useTabStore as unknown as Record<string, unknown>).getState = () => {
        throw "string error";
      };

      await handleWindowsList("req-str-err-1");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-str-err-1",
        success: false,
        error: "string error",
      });

      (origTabStore.useTabStore as unknown as Record<string, unknown>).getState = origGetState;
    });

    it("handleWindowsGetFocused returns String(error) for non-Error throws (line 64)", async () => {
      // Make respond throw on the first call to trigger catch
      mockRespond.mockImplementationOnce(() => { throw "respond error"; });

      await handleWindowsGetFocused("req-str-err-2");

      // Second call is the error response
      const call = mockRespond.mock.calls[1][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("respond error");
    });

    it("handleWindowsFocus returns String(error) for non-Error throws (line 93)", async () => {
      // getCurrentWindow().setFocus throws a non-Error
      const origGetCurrentWindow = await import("@tauri-apps/api/window");
      const origFn = origGetCurrentWindow.getCurrentWindow;
      (origGetCurrentWindow as unknown as Record<string, unknown>).getCurrentWindow = () => ({
        setFocus: () => Promise.reject("focus error"),
      });

      await handleWindowsFocus("req-str-err-3", { windowId: "main" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("focus error");

      (origGetCurrentWindow as unknown as Record<string, unknown>).getCurrentWindow = origFn;
    });

    it("handleWorkspaceNewDocument returns String(error) for non-Error throws (line 116)", async () => {
      mockTabStoreState.createTab.mockImplementationOnce(() => { throw "create error"; });

      await handleWorkspaceNewDocument("req-str-err-4");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("create error");
    });

    it("handleWorkspaceOpenDocument returns String(error) for non-Error throws (line 150)", async () => {
      const origFs = await import("@tauri-apps/plugin-fs");
      const origReadTextFile = origFs.readTextFile;
      (origFs as unknown as Record<string, unknown>).readTextFile = () => Promise.reject("read error");

      await handleWorkspaceOpenDocument("req-str-err-5", { path: "/test.md" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("read error");

      (origFs as unknown as Record<string, unknown>).readTextFile = origReadTextFile;
    });

    it("handleWorkspaceSaveDocument returns String(error) for non-Error throws (line 185)", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: true,
        content: "# Content",
      });
      const origFs = await import("@tauri-apps/plugin-fs");
      const origWriteTextFile = origFs.writeTextFile;
      (origFs as unknown as Record<string, unknown>).writeTextFile = () => Promise.reject("write error");

      await handleWorkspaceSaveDocument("req-str-err-6");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("write error");

      (origFs as unknown as Record<string, unknown>).writeTextFile = origWriteTextFile;
    });

    it("handleWorkspaceCloseWindow returns String(error) for non-Error throws (line 211)", async () => {
      mockTabStoreState.closeTab.mockImplementationOnce(() => { throw 42; });

      await handleWorkspaceCloseWindow("req-str-err-7", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("42");
    });

    it("handleWorkspaceSaveDocumentAs returns String(error) for non-Error throws (line 257)", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: true,
        content: "# Content",
      });
      const origFs = await import("@tauri-apps/plugin-fs");
      const origWriteTextFile = origFs.writeTextFile;
      (origFs as unknown as Record<string, unknown>).writeTextFile = () => Promise.reject("save-as error");

      await handleWorkspaceSaveDocumentAs("req-str-err-8", { path: "/new.md" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("save-as error");

      (origFs as unknown as Record<string, unknown>).writeTextFile = origWriteTextFile;
    });

    it("handleWorkspaceGetDocumentInfo returns String(error) for non-Error throws (line 308)", async () => {
      mockTabStoreState.activeTabId = { main: "tab-1" };
      mockDocStoreState.getDocument.mockImplementationOnce(() => { throw "doc info error"; });

      await handleWorkspaceGetDocumentInfo("req-str-err-9", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("doc info error");
    });

    it("handleWorkspaceListRecentFiles returns String(error) for non-Error (line 331)", async () => {
      const origRecentFiles = await import("@/stores/recentFilesStore");
      const origGetState = origRecentFiles.useRecentFilesStore.getState;
      (origRecentFiles.useRecentFilesStore as unknown as Record<string, unknown>).getState = () => {
        throw 123;
      };

      await handleWorkspaceListRecentFiles("req-str-err-10");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("123");

      (origRecentFiles.useRecentFilesStore as unknown as Record<string, unknown>).getState = origGetState;
    });

    it("handleWorkspaceGetInfo returns String(error) for non-Error (line 365)", async () => {
      const origWorkspace = await import("@/stores/workspaceStore");
      const origGetState = origWorkspace.useWorkspaceStore.getState;
      (origWorkspace.useWorkspaceStore as unknown as Record<string, unknown>).getState = () => {
        throw false;
      };

      await handleWorkspaceGetInfo("req-str-err-11");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("false");

      (origWorkspace.useWorkspaceStore as unknown as Record<string, unknown>).getState = origGetState;
    });

    it("handleWorkspaceReloadDocument returns String(error) for non-Error (line 413)", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/test.md",
        isDirty: false,
      });
      const origReload = await import("@/utils/reloadFromDisk");
      const origFn = origReload.reloadTabFromDisk;
      (origReload as unknown as Record<string, unknown>).reloadTabFromDisk = () => Promise.reject("reload error");

      await handleWorkspaceReloadDocument("req-str-err-12", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("reload error");

      (origReload as unknown as Record<string, unknown>).reloadTabFromDisk = origFn;
    });
  });

  describe("instanceof Error true branch — catch blocks (lines 49, 64, 116)", () => {
    it("handleWindowsList returns error.message for Error instances (line 49)", async () => {
      const origTabStore = await import("@/stores/tabStore");
      const origGetState = origTabStore.useTabStore.getState;
      (origTabStore.useTabStore as unknown as Record<string, unknown>).getState = () => {
        throw new Error("real error message");
      };

      await handleWindowsList("req-instanceof-1");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-instanceof-1",
        success: false,
        error: "real error message",
      });

      (origTabStore.useTabStore as unknown as Record<string, unknown>).getState = origGetState;
    });

    it("handleWindowsGetFocused returns error.message for Error instances (line 64)", async () => {
      // Make the first respond() call throw an Error instance to trigger the catch
      mockRespond.mockImplementationOnce(() => { throw new Error("focused error"); });

      await handleWindowsGetFocused("req-instanceof-2");

      const call = mockRespond.mock.calls[1][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("focused error");
    });

    it("handleWorkspaceNewDocument returns error.message for Error instances (line 116)", async () => {
      mockTabStoreState.createTab.mockImplementationOnce(() => {
        throw new Error("new doc error");
      });

      await handleWorkspaceNewDocument("req-instanceof-3");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-instanceof-3",
        success: false,
        error: "new doc error",
      });
    });
  });

  describe("handleWorkspaceSaveDocumentAs — getFileName empty string fallback (line 248)", () => {
    it("uses Untitled when getFileName returns empty string", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/old/path.md",
        isDirty: false,
        content: "# Content",
      });

      // Pass a path whose last segment is empty so getFileName returns ""
      // Our mock: getFileName = path.split("/").pop() ?? "" — "/" gives ""
      await handleWorkspaceSaveDocumentAs("req-empty-getfilename", {
        path: "/",
      });

      expect(mockTabStoreState.updateTabTitle).toHaveBeenCalledWith("tab-1", "Untitled");
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  describe("handleWindowsList — getFileName returns empty string (line 38 fallback)", () => {
    it("returns Untitled when getFileName returns empty string for filePath", async () => {
      mockDocStoreState.getDocument.mockReturnValue({
        filePath: "/",
        isDirty: false,
      });

      await handleWindowsList("req-empty-fn");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // getFileName("/") returns "" → fallback to "Untitled"
      expect(call.data[0].title).toBe("Untitled");
    });
  });

  describe("handleWorkspaceGetDocumentInfo — no tab found (lines 297-299 fallbacks)", () => {
    it("returns defaults when doc and tab are null/undefined", async () => {
      mockGetEditor.mockReturnValue({
        state: {
          doc: { textContent: "hello" },
        },
      });
      mockDocStoreState.getDocument.mockReturnValue(null);
      mockTabStoreState.tabs = { main: [] };

      await handleWorkspaceGetDocumentInfo("req-no-tab", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.filePath).toBeNull();
      expect(call.data.isDirty).toBe(false);
      expect(call.data.title).toBe("Untitled");
    });
  });
});
