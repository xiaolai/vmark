/**
 * MCP Bridge — Workspace Handler Tests
 *
 * Tests for workspace operations: windows.list, windows.getFocused,
 * workspace.newDocument, workspace.openDocument, workspace.saveDocument,
 * workspace.getDocumentInfo, workspace.listRecentFiles, workspace.getInfo,
 * workspace.reloadDocument.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleWindowsList,
  handleWindowsGetFocused,
  handleWorkspaceNewDocument,
  handleWorkspaceOpenDocument,
  handleWorkspaceSaveDocument,
  handleWorkspaceGetDocumentInfo,
  handleWorkspaceListRecentFiles,
  handleWorkspaceGetInfo,
  handleWorkspaceReloadDocument,
} from "./workspaceHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
  resolveWindowId: vi.fn((id?: string) => id ?? "main"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(() => Promise.resolve("# Hello")),
  writeTextFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setFocus: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock("@/utils/markdownPipeline", () => ({
  serializeMarkdown: vi.fn(() => "# Serialized"),
}));

vi.mock("@/utils/paths", () => ({
  getFileName: vi.fn((path: string) => path.split("/").pop() ?? ""),
}));

vi.mock("@/utils/reloadFromDisk", () => ({
  reloadTabFromDisk: vi.fn(() => Promise.resolve()),
}));

const mockTabStore = {
  tabs: { main: [{ id: "tab-1", title: "Doc", filePath: "/doc.md" }] },
  activeTabId: { main: "tab-1" },
  createTab: vi.fn(() => "tab-new"),
  closeTab: vi.fn(),
  updateTabPath: vi.fn(),
  updateTabTitle: vi.fn(),
};

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(() => mockTabStore),
  },
}));

const mockDocStore = {
  getDocument: vi.fn(() => ({ filePath: "/doc.md", isDirty: false })),
  initDocument: vi.fn(),
  markSaved: vi.fn(),
  setFilePath: vi.fn(),
};

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => mockDocStore),
  },
}));

vi.mock("@/stores/recentFilesStore", () => ({
  useRecentFilesStore: {
    getState: vi.fn(() => ({
      files: ["/recent1.md", "/recent2.md"],
    })),
  },
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      isWorkspaceMode: true,
      rootPath: "/home/user/projects/my-project",
    })),
  },
}));

import { respond, getEditor } from "./utils";

describe("workspaceHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabStore.activeTabId = { main: "tab-1" };
    mockDocStore.getDocument.mockReturnValue({ filePath: "/doc.md", isDirty: false });
  });

  describe("handleWindowsList", () => {
    it("returns single main window", async () => {
      await handleWindowsList("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: [
          expect.objectContaining({
            label: "main",
            isFocused: true,
            isAiExposed: true,
          }),
        ],
      });
    });
  });

  describe("handleWindowsGetFocused", () => {
    it('returns "main"', async () => {
      await handleWindowsGetFocused("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: "main",
      });
    });
  });

  describe("handleWorkspaceNewDocument", () => {
    it("creates new tab and empty document", async () => {
      await handleWorkspaceNewDocument("req-1");

      expect(mockTabStore.createTab).toHaveBeenCalledWith("main", null);
      expect(mockDocStore.initDocument).toHaveBeenCalledWith("tab-new", "", null);
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { windowId: "main" },
      });
    });
  });

  describe("handleWorkspaceOpenDocument", () => {
    it("opens document from path", async () => {
      await handleWorkspaceOpenDocument("req-1", { path: "/test.md" });

      expect(mockTabStore.createTab).toHaveBeenCalledWith("main", "/test.md");
      expect(mockDocStore.initDocument).toHaveBeenCalledWith("tab-new", "# Hello", "/test.md");
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { windowId: "main" },
      });
    });

    it("returns error when path missing", async () => {
      await handleWorkspaceOpenDocument("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "path is required",
      });
    });
  });

  describe("handleWorkspaceSaveDocument", () => {
    it("saves document to file", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: {
          schema: {},
          doc: {},
        },
      } as never);

      await handleWorkspaceSaveDocument("req-1");

      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when no active document", async () => {
      mockTabStore.activeTabId = { main: undefined as unknown as string };

      await handleWorkspaceSaveDocument("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active document",
      });
    });

    it("returns error when document has no file path", async () => {
      mockDocStore.getDocument.mockReturnValue({ filePath: null, isDirty: false });

      await handleWorkspaceSaveDocument("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Document has no file path (use save-as instead)",
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleWorkspaceSaveDocument("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleWorkspaceGetDocumentInfo", () => {
    it("returns document info with word count", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: {
          doc: { textContent: "hello world foo" },
        },
      } as never);

      await handleWorkspaceGetDocumentInfo("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          filePath: "/doc.md",
          isDirty: false,
          wordCount: 3,
          charCount: 15,
        }),
      });
    });

    it("returns error when no active document", async () => {
      mockTabStore.activeTabId = { main: undefined as unknown as string };

      await handleWorkspaceGetDocumentInfo("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active document",
      });
    });
  });

  describe("handleWorkspaceListRecentFiles", () => {
    it("returns recent files list", async () => {
      await handleWorkspaceListRecentFiles("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: ["/recent1.md", "/recent2.md"],
      });
    });
  });

  describe("handleWorkspaceGetInfo", () => {
    it("returns workspace info", async () => {
      await handleWorkspaceGetInfo("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          isWorkspaceMode: true,
          rootPath: "/home/user/projects/my-project",
          workspaceName: "my-project",
        },
      });
    });
  });

  describe("handleWorkspaceReloadDocument", () => {
    it("reloads document from disk", async () => {
      await handleWorkspaceReloadDocument("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { filePath: "/doc.md" },
      });
    });

    it("returns error when no active document", async () => {
      mockTabStore.activeTabId = { main: undefined as unknown as string };

      await handleWorkspaceReloadDocument("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active document",
      });
    });

    it("returns error for untitled document", async () => {
      mockDocStore.getDocument.mockReturnValue({ filePath: null, isDirty: false });

      await handleWorkspaceReloadDocument("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Document has no file path (untitled documents cannot be reloaded)",
      });
    });

    it("returns error for dirty document without force", async () => {
      mockDocStore.getDocument.mockReturnValue({ filePath: "/doc.md", isDirty: true });

      await handleWorkspaceReloadDocument("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: expect.stringContaining("unsaved changes"),
      });
    });

    it("reloads dirty document with force=true", async () => {
      mockDocStore.getDocument.mockReturnValue({ filePath: "/doc.md", isDirty: true });

      await handleWorkspaceReloadDocument("req-1", { force: true });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { filePath: "/doc.md" },
      });
    });
  });
});
