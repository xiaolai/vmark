/**
 * Tests for useFileOperations hook
 *
 * @module hooks/useFileOperations.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Hoist mocks to avoid "Cannot access before initialization" errors
const {
  mockInvoke, mockClose, mockCloseTab, mockDetachTab, mockReadTextFile,
  mockInitDocument, mockSetLineMetadata, mockAddFile,
  mockCreateTab, mockSetActiveTab,
  mockUseFileShortcuts,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(() => Promise.resolve()),
  mockClose: vi.fn(() => Promise.resolve()),
  mockCloseTab: vi.fn(),
  mockDetachTab: vi.fn(),
  mockReadTextFile: vi.fn(() => Promise.resolve("# Hello")),
  mockInitDocument: vi.fn(),
  mockSetLineMetadata: vi.fn(),
  mockAddFile: vi.fn(),
  mockCreateTab: vi.fn(() => "new-tab-id"),
  mockSetActiveTab: vi.fn(),
  mockUseFileShortcuts: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    close: mockClose,
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mockReadTextFile,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(),
  },
  useRecentFilesStore: {
    getState: vi.fn(() => ({
      addFile: mockAddFile,
    })),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      initDocument: mockInitDocument,
      setLineMetadata: mockSetLineMetadata,
    })),
  },
}));

vi.mock("@/utils/paths", () => ({
  isWithinRoot: vi.fn(),
  getParentDir: vi.fn((path: string) => {
    const lastSlash = path.lastIndexOf("/");
    return lastSlash > 0 ? path.substring(0, lastSlash) : "";
  }),
}));

vi.mock("@/utils/perfLog", () => ({
  perfReset: vi.fn(),
  perfStart: vi.fn(),
  perfEnd: vi.fn(),
  perfMark: vi.fn(),
}));

vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: vi.fn(() => ({ lineEnding: "lf", hasMixedLineEndings: false })),
}));

vi.mock("@/hooks/useReplaceableTab", () => ({
  findExistingTabForPath: vi.fn(() => null),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: vi.fn(() => "main"),
}));

vi.mock("./useFileShortcuts", () => ({
  useFileShortcuts: mockUseFileShortcuts,
}));

import { moveTabToNewWorkspaceWindow, openFileInNewTabCore, useFileOperations } from "./useFileOperations";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { isWithinRoot } from "@/utils/paths";
import { toast } from "sonner";

describe("moveTabToNewWorkspaceWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default workspace setup
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace",
    } as ReturnType<typeof useWorkspaceStore.getState>);

    // Default tab setup - multiple tabs
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);
  });

  it("does nothing when no workspace is set", async () => {
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: null,
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/some/file.md");

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockCloseTab).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("does nothing when file is within workspace", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(true);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/workspace/file.md");

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockCloseTab).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("opens new workspace window when file is outside workspace", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/folder/file.md");

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/other/folder",
      filePath: "/other/folder/file.md",
    });
  });

  it("closes only the tab when multiple tabs exist", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-1");
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("closes entire window when it is the last tab", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }] }, // Only one tab
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    expect(mockClose).toHaveBeenCalled();
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("handles empty tabs array as last tab", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [] }, // Edge case: empty array
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    // Length 0 < 1, so isLastTab is false (0 !== 1), but we treat empty as "close window"
    // Actually: 0 === 1 is false, so it will close tab, not window
    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-1");
  });

  it("handles missing window label in tabs", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {}, // No "main" key
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    // tabs["main"] is undefined, || [] makes it empty array, length 0 !== 1
    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-1");
  });

  it("derives workspace root from file parent directory", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/deep/nested/folder/file.md");

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/deep/nested/folder",
      filePath: "/deep/nested/folder/file.md",
    });
  });

  it("uses isWithinRoot for path comparison (not string prefix)", async () => {
    // This tests that we use isWithinRoot which handles edge cases like
    // /workspace vs /workspace-other correctly
    vi.mocked(isWithinRoot).mockImplementation((root, target) => {
      // Simulate proper boundary checking
      const normalizedRoot = root.replace(/\/$/, "");
      const normalizedTarget = target.replace(/\/$/, "");
      return normalizedTarget === normalizedRoot ||
        normalizedTarget.startsWith(normalizedRoot + "/");
    });

    // /workspace-other should NOT be within /workspace
    await moveTabToNewWorkspaceWindow("main", "tab-1", "/workspace-other/file.md");

    expect(mockInvoke).toHaveBeenCalled();
  });
});

describe("openFileInNewTabCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // getTabsByWindow returns [] before createTab, then [{id}] after — simulates new tab
    const mockGetTabsByWindow = vi.fn()
      .mockReturnValueOnce([])                                    // before createTab
      .mockReturnValueOnce([{ id: "new-tab-id" }]);              // after createTab

    vi.mocked(useTabStore.getState).mockReturnValue({
      createTab: mockCreateTab,
      setActiveTab: mockSetActiveTab,
      closeTab: mockCloseTab,
      detachTab: mockDetachTab,
      getTabsByWindow: mockGetTabsByWindow,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    mockReadTextFile.mockResolvedValue("# Hello World");
    mockCreateTab.mockReturnValue("new-tab-id");
  });

  it("creates tab and initializes document on success", async () => {
    await openFileInNewTabCore("main", "/path/to/file.md");

    expect(mockCreateTab).toHaveBeenCalledWith("main", "/path/to/file.md");
    expect(mockReadTextFile).toHaveBeenCalledWith("/path/to/file.md");
    expect(mockInitDocument).toHaveBeenCalledWith("new-tab-id", "# Hello World", "/path/to/file.md");
    expect(mockAddFile).toHaveBeenCalledWith("/path/to/file.md");
  });

  it("closes orphaned tab when readTextFile throws", async () => {
    mockReadTextFile.mockRejectedValue(new Error("Permission denied"));

    await openFileInNewTabCore("main", "/path/to/file.md");

    // Tab was created, then read failed — tab must be detached (not closeTab,
    // to avoid polluting "reopen closed tab" history)
    expect(mockCreateTab).toHaveBeenCalledWith("main", "/path/to/file.md");
    expect(mockDetachTab).toHaveBeenCalledWith("main", "new-tab-id");
    expect(mockInitDocument).not.toHaveBeenCalled();
  });

  it("shows toast error when readTextFile throws", async () => {
    mockReadTextFile.mockRejectedValue(new Error("File not found"));

    await openFileInNewTabCore("main", "/path/missing.md");

    expect(toast.error).toHaveBeenCalled();
  });

  it("does not add to recent files when readTextFile throws", async () => {
    mockReadTextFile.mockRejectedValue(new Error("Binary file"));

    await openFileInNewTabCore("main", "/path/to/binary.png");

    expect(mockAddFile).not.toHaveBeenCalled();
  });
});

describe("useFileOperations hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to useFileShortcuts with the current window label", () => {
    renderHook(() => useFileOperations());

    expect(mockUseFileShortcuts).toHaveBeenCalledWith("main");
  });

  it("passes window label from context to useFileShortcuts", async () => {
    const { useWindowLabel } = await import("@/contexts/WindowContext");
    vi.mocked(useWindowLabel).mockReturnValue("doc-1");

    renderHook(() => useFileOperations());

    expect(mockUseFileShortcuts).toHaveBeenCalledWith("doc-1");

    // Reset to default
    vi.mocked(useWindowLabel).mockReturnValue("main");
  });
});
