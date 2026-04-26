/**
 * Tests for useFileSave — save dialog, move tab, Save/SaveAs/MoveTo/SaveAllQuit handlers
 *
 * @module hooks/useFileSave.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist mocks
const {
  mockInvoke, mockSaveDialog, mockRemove, mockClose,
  mockSaveToPath, mockFlush, mockCloseTab,
  mockOpenWorkspaceWithConfig, mockSaveAllDocuments,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(() => Promise.resolve()),
  mockSaveDialog: vi.fn(() => Promise.resolve(null as string | null)),
  mockRemove: vi.fn(() => Promise.resolve()),
  mockClose: vi.fn(() => Promise.resolve()),
  mockSaveToPath: vi.fn(() => Promise.resolve(true)),
  mockFlush: vi.fn(),
  mockCloseTab: vi.fn(),
  mockOpenWorkspaceWithConfig: vi.fn(() => Promise.resolve(null)),
  mockSaveAllDocuments: vi.fn(() => Promise.resolve({ action: "saved-all" })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mockSaveDialog,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  remove: mockRemove,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    close: mockClose,
  })),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/hooks/useDefaultSaveFolder", () => ({
  getDefaultSaveFolderWithFallback: vi.fn(() => Promise.resolve("/Users/test/Documents")),
}));

vi.mock("@/utils/wysiwygFlush", () => ({
  flushActiveWysiwygNow: mockFlush,
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: vi.fn(async (_wl: string, _op: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/utils/saveToPath", () => ({
  saveToPath: mockSaveToPath,
}));

vi.mock("@/utils/openPolicy", () => ({
  resolvePostSaveWorkspaceAction: vi.fn(() => ({ action: "none" })),
  resolveMissingFileSaveAction: vi.fn(() => "save_allowed"),
}));

vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: mockOpenWorkspaceWithConfig,
}));

vi.mock("@/utils/pathUtils", () => ({
  joinPath: vi.fn((...parts: string[]) => parts.join("/")),
}));

vi.mock("@/utils/exportNaming", () => ({
  getSaveFileName: vi.fn(() => "Untitled"),
}));

vi.mock("@/utils/paths", () => ({
  isWithinRoot: vi.fn(() => true),
  getParentDir: vi.fn((path: string) => {
    const lastSlash = path.lastIndexOf("/");
    return lastSlash > 0 ? path.substring(0, lastSlash) : "";
  }),
}));

vi.mock("@/hooks/closeSave", () => ({
  saveAllDocuments: mockSaveAllDocuments,
}));

vi.mock("@/utils/debug", () => ({
  fileOpsLog: vi.fn(),
  fileOpsWarn: vi.fn(),
  fileOpsError: vi.fn(),
}));

import {
  saveDialogWithFallback,
  moveTabToNewWorkspaceWindow,
  handleSave,
  handleSaveAs,
  handleMoveTo,
  handleSaveAllQuit,
} from "./useFileSave";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { isWithinRoot } from "@/utils/paths";
import { resolveMissingFileSaveAction, resolvePostSaveWorkspaceAction } from "@/utils/openPolicy";
import { withReentryGuard } from "@/utils/reentryGuard";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// saveDialogWithFallback
// ---------------------------------------------------------------------------
describe("saveDialogWithFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns path on successful save", async () => {
    mockSaveDialog.mockResolvedValueOnce("/path/to/saved.md");

    const result = await saveDialogWithFallback("/default/path.md");

    expect(result).toBe("/path/to/saved.md");
    expect(mockSaveDialog).toHaveBeenCalledTimes(1);
    expect(mockSaveDialog).toHaveBeenCalledWith({ defaultPath: "/default/path.md" });
  });

  it("returns null when user cancels dialog", async () => {
    mockSaveDialog.mockResolvedValueOnce(null);

    const result = await saveDialogWithFallback("/default/path.md");

    expect(result).toBeNull();
  });

  it("propagates non-timeout errors immediately", async () => {
    const error = new Error("Dialog crashed");
    mockSaveDialog.mockRejectedValueOnce(error);

    await expect(saveDialogWithFallback("/path.md")).rejects.toThrow("Dialog crashed");
    // Only 1 call — no retry because it wasn't a timeout
    expect(mockSaveDialog).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// moveTabToNewWorkspaceWindow
// ---------------------------------------------------------------------------
describe("moveTabToNewWorkspaceWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace",
    } as ReturnType<typeof useWorkspaceStore.getState>);

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);
  });

  it("does nothing when no workspace root is set", async () => {
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: null,
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/some/file.md");

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does nothing when file is within workspace", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(true);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/workspace/file.md");

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("opens new window when file is outside workspace", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/folder/file.md");

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/other/folder",
      filePath: "/other/folder/file.md",
    });
  });

  it("closes tab when multiple tabs exist", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-1");
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("shows error toast when invoke throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(isWithinRoot).mockReturnValue(false);
    mockInvoke.mockRejectedValueOnce(new Error("IPC failed"));

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    expect(toast.error).toHaveBeenCalledWith("Failed to move file to new window");
    // Should not close tab or window
    expect(mockCloseTab).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("closes entire window when it is the last tab", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }] },
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    expect(mockClose).toHaveBeenCalled();
    expect(mockCloseTab).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSave
// ---------------------------------------------------------------------------
describe("handleSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Hello",
        filePath: "/workspace/test.md",
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      isWorkspaceMode: true,
      rootPath: "/workspace",
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);

    vi.mocked(resolveMissingFileSaveAction).mockReturnValue("save_allowed" as never);
    vi.mocked(resolvePostSaveWorkspaceAction).mockReturnValue({ action: "none" } as never);
    mockSaveToPath.mockResolvedValue(true);
  });

  it("flushes WYSIWYG before saving", async () => {
    await handleSave("main");

    expect(mockFlush).toHaveBeenCalled();
  });

  it("saves to existing file path directly", async () => {
    await handleSave("main");

    expect(mockSaveToPath).toHaveBeenCalledWith(
      "tab-1",
      "/workspace/test.md",
      "# Hello",
      "manual",
    );
  });

  it("does nothing when no active tab", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: null },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await handleSave("main");

    expect(mockSaveToPath).not.toHaveBeenCalled();
  });

  it("does nothing when document not found", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => null),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    await handleSave("main");

    expect(mockSaveToPath).not.toHaveBeenCalled();
  });

  it("opens save dialog for untitled documents", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Untitled",
        filePath: null,
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockResolvedValueOnce("/saved/new-file.md");

    await handleSave("main");

    expect(mockSaveDialog).toHaveBeenCalled();
    expect(mockSaveToPath).toHaveBeenCalledWith(
      "tab-1",
      "/saved/new-file.md",
      "# Untitled",
      "manual",
    );
  });

  it("does not save when dialog is cancelled", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Untitled",
        filePath: null,
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockResolvedValueOnce(null);

    await handleSave("main");

    expect(mockSaveToPath).not.toHaveBeenCalled();
  });

  it("shows toast on save dialog error", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Untitled",
        filePath: null,
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockRejectedValueOnce(new Error("Dialog crashed"));

    await handleSave("main");

    // Pin: dialog errors include system details worth reading carefully
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Dialog crashed"),
      expect.objectContaining({ action: expect.any(Object) }),
    );
  });

  it("falls through to Save As when saveToPath fails and parent dir vanishes", async () => {
    // Regression: saveToPath flips isMissing when the file's parent
    // directory was renamed/deleted externally (PARENT_MISSING sentinel).
    // handleSave should detect that transition and immediately route into
    // Save As — no second click required.
    let getDocCallCount = 0;
    const getDocumentMock = vi.fn(() => {
      getDocCallCount += 1;
      // First call (initial fetch) returns a normal on-disk doc.
      // Second call (post-save refresh) returns isMissing=true to simulate
      // saveToPath having flagged it after the parent dir disappeared.
      return {
        content: "# Hello",
        filePath: "/workspace/test.md",
        isDirty: true,
        isMissing: getDocCallCount >= 2,
      };
    });
    const clearMissingMock = vi.fn();
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: getDocumentMock,
      clearMissing: clearMissingMock,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    // First saveToPath call (normal save path) fails; second (recovery via
    // Save As) succeeds.
    mockSaveToPath
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockSaveDialog.mockResolvedValueOnce("/workspace/restored.md");

    await handleSave("main");

    // Save dialog opened as recovery
    expect(mockSaveDialog).toHaveBeenCalled();
    // saveToPath called twice: original target then user-chosen recovery path
    expect(mockSaveToPath).toHaveBeenCalledTimes(2);
    expect(mockSaveToPath).toHaveBeenNthCalledWith(
      1, "tab-1", "/workspace/test.md", "# Hello", "manual",
    );
    expect(mockSaveToPath).toHaveBeenNthCalledWith(
      2, "tab-1", "/workspace/restored.md", "# Hello", "manual",
    );
  });

  it("does not enter Save As when saveToPath fails for non-missing reason", async () => {
    // Defensive: if saveToPath returns false but isMissing was NOT flipped
    // (e.g., disk full, permission denied), we should NOT auto-route to
    // Save As — the user's intent was a normal save, and a confusing
    // dialog would not help.
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Hello",
        filePath: "/workspace/test.md",
        isDirty: true,
        isMissing: false,  // Stays false even after failure
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveToPath.mockResolvedValueOnce(false);

    await handleSave("main");

    expect(mockSaveToPath).toHaveBeenCalledTimes(1);
    expect(mockSaveDialog).not.toHaveBeenCalled();
  });

  it("forces Save As when file is missing", async () => {
    vi.mocked(resolveMissingFileSaveAction).mockReturnValue("save_as_required" as never);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Deleted",
        filePath: "/workspace/deleted.md",
        isDirty: true,
        isMissing: true,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockResolvedValueOnce("/workspace/restored.md");

    await handleSave("main");

    expect(mockSaveDialog).toHaveBeenCalled();
  });

  it("opens workspace after saving first untitled file", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# New",
        filePath: null,
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(resolvePostSaveWorkspaceAction).mockReturnValue({
      action: "open_workspace",
      workspaceRoot: "/saved/folder",
    } as never);

    mockSaveDialog.mockResolvedValueOnce("/saved/folder/file.md");
    mockSaveToPath.mockResolvedValue(true);

    await handleSave("main");

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/saved/folder");
  });
});

// ---------------------------------------------------------------------------
// handleSaveAs
// ---------------------------------------------------------------------------
describe("handleSaveAs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/test.md",
        isDirty: false,
        isMissing: false,
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace",
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);
  });

  it("flushes WYSIWYG before Save As", async () => {
    mockSaveDialog.mockResolvedValueOnce(null);

    await handleSaveAs("main");

    expect(mockFlush).toHaveBeenCalled();
  });

  it("does nothing when no active tab", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: null },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await handleSaveAs("main");

    expect(mockSaveDialog).not.toHaveBeenCalled();
  });

  it("saves to chosen path on dialog success", async () => {
    mockSaveDialog.mockResolvedValueOnce("/other/location.md");
    mockSaveToPath.mockResolvedValue(true);

    await handleSaveAs("main");

    expect(mockSaveToPath).toHaveBeenCalledWith(
      "tab-1",
      "/other/location.md",
      "# Content",
      "manual",
    );
  });

  it("does nothing when dialog is cancelled", async () => {
    mockSaveDialog.mockResolvedValueOnce(null);

    await handleSaveAs("main");

    expect(mockSaveToPath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleMoveTo
// ---------------------------------------------------------------------------
describe("handleMoveTo", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/old.md",
        isDirty: false,
        isMissing: false,
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace",
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);
  });

  it("saves to new path and deletes old file", async () => {
    mockSaveDialog.mockResolvedValueOnce("/new/location.md");
    mockSaveToPath.mockResolvedValue(true);

    await handleMoveTo("main");

    expect(mockSaveToPath).toHaveBeenCalledWith(
      "tab-1",
      "/new/location.md",
      "# Content",
      "manual",
    );
    expect(mockRemove).toHaveBeenCalledWith("/workspace/old.md");
  });

  it("does not delete when choosing same path", async () => {
    mockSaveDialog.mockResolvedValueOnce("/workspace/old.md");

    await handleMoveTo("main");

    expect(mockSaveToPath).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("does not delete old file for untitled documents", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: null,
        isDirty: false,
        isMissing: false,
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockResolvedValueOnce("/new/location.md");
    mockSaveToPath.mockResolvedValue(true);

    await handleMoveTo("main");

    expect(mockSaveToPath).toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("shows warning toast when old file deletion fails", async () => {
    mockSaveDialog.mockResolvedValueOnce("/new/location.md");
    mockSaveToPath.mockResolvedValue(true);
    mockRemove.mockRejectedValueOnce(new Error("Permission denied"));

    await handleMoveTo("main");

    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("couldn't delete original"),
    );
  });

  it("does nothing when dialog cancelled", async () => {
    mockSaveDialog.mockResolvedValueOnce(null);

    await handleMoveTo("main");

    expect(mockSaveToPath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSaveAllQuit
// ---------------------------------------------------------------------------
describe("handleSaveAllQuit", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getAllDirtyDocuments: vi.fn(() => []),
      getDocument: vi.fn(() => null),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {},
    } as unknown as ReturnType<typeof useTabStore.getState>);
  });

  it("quits immediately when no dirty documents", async () => {
    await handleSaveAllQuit("main");

    expect(mockInvoke).toHaveBeenCalledWith("force_quit");
  });

  it("saves all dirty documents then quits", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getAllDirtyDocuments: vi.fn(() => ["tab-1"]),
      getDocument: vi.fn(() => ({
        content: "# Dirty",
        filePath: "/workspace/dirty.md",
        isDirty: true,
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1", title: "Dirty" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    mockSaveAllDocuments.mockResolvedValueOnce({ action: "saved-all" });

    await handleSaveAllQuit("main");

    expect(mockSaveAllDocuments).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("force_quit");
  });

  it("does not quit when save is cancelled", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getAllDirtyDocuments: vi.fn(() => ["tab-1"]),
      getDocument: vi.fn(() => ({
        content: "# Dirty",
        filePath: null,
        isDirty: true,
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1", title: "Untitled" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    mockSaveAllDocuments.mockResolvedValueOnce({ action: "cancelled" });

    await handleSaveAllQuit("main");

    expect(mockInvoke).not.toHaveBeenCalledWith("force_quit");
  });

  it("shows toast error when save throws", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getAllDirtyDocuments: vi.fn(() => { throw new Error("Store error"); }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    await handleSaveAllQuit("main");

    expect(toast.error).toHaveBeenCalledWith("Failed to save documents");
  });

  it("handles re-entry guard blocking", async () => {
    vi.mocked(withReentryGuard).mockResolvedValueOnce(undefined);

    await handleSaveAllQuit("main");

    // Should not throw, just silently skip
  });

  it("quits when dirty tabs produce empty contexts (doc not dirty)", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getAllDirtyDocuments: vi.fn(() => ["tab-1"]),
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/file.md",
        isDirty: false, // not actually dirty
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1", title: "File" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await handleSaveAllQuit("main");

    expect(mockInvoke).toHaveBeenCalledWith("force_quit");
  });

  it("uses fallback windowLabel when tab not found in any window", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getAllDirtyDocuments: vi.fn(() => ["orphan-tab"]),
      getDocument: vi.fn(() => ({
        content: "# Orphan",
        filePath: null,
        isDirty: true,
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {}, // no windows at all
    } as unknown as ReturnType<typeof useTabStore.getState>);

    mockSaveAllDocuments.mockResolvedValueOnce({ action: "saved-all" });

    await handleSaveAllQuit("main");

    expect(mockSaveAllDocuments).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          windowLabel: "main", // fallback
          title: "Untitled",
        }),
      ]),
    );
    expect(mockInvoke).toHaveBeenCalledWith("force_quit");
  });
});


// ---------------------------------------------------------------------------
// moveTabToNewWorkspaceWindow — window with no tabs array
// ---------------------------------------------------------------------------
describe("moveTabToNewWorkspaceWindow — empty tabs array fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses empty array fallback when window has no tabs entry (line 117)", async () => {
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace",
    } as ReturnType<typeof useWorkspaceStore.getState>);

    vi.mocked(isWithinRoot).mockReturnValue(false);

    // tabs[windowLabel] is undefined — falls back to []
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {},
      closeTab: vi.fn(),
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    // With empty tabs array, isLastTab would be false (0 === 1 is false),
    // but since there are 0 tabs, it goes to closeTab branch
    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", expect.anything());
  });
});


// ---------------------------------------------------------------------------
// handleSave — missing file and workspace opening edge cases
// ---------------------------------------------------------------------------
describe("handleSave — additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      isWorkspaceMode: false,
      rootPath: null,
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);
  });

  it("clears missing flag when missing file is saved successfully via Save As", async () => {
    const mockClearMissing = vi.fn();
    vi.mocked(resolveMissingFileSaveAction).mockReturnValue("save_as_required" as never);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Missing",
        filePath: "/workspace/gone.md",
        isDirty: true,
        isMissing: true,
      })),
      clearMissing: mockClearMissing,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockResolvedValueOnce("/workspace/restored.md");
    mockSaveToPath.mockResolvedValue(true);

    await handleSave("main");

    expect(mockClearMissing).toHaveBeenCalledWith("tab-1");
  });

  it("does not save when saveToPath returns false", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/test.md",
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(resolveMissingFileSaveAction).mockReturnValue("save_allowed" as never);
    mockSaveToPath.mockResolvedValue(false);

    await handleSave("main");

    // No workspace open attempt because save failed
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("handles openWorkspaceWithConfig failure gracefully", async () => {
    const { fileOpsError } = await import("@/utils/debug");
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# New",
        filePath: null,
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(resolvePostSaveWorkspaceAction).mockReturnValue({
      action: "open_workspace",
      workspaceRoot: "/folder",
    } as never);

    mockSaveDialog.mockResolvedValueOnce("/folder/file.md");
    mockSaveToPath.mockResolvedValue(true);
    mockOpenWorkspaceWithConfig.mockRejectedValueOnce(new Error("workspace fail"));

    await handleSave("main");

    // Should not throw — error is logged via fileOpsError (mocked)
    expect(fileOpsError).toHaveBeenCalled();
  });

  it("logs warning when re-entry guard blocks save", async () => {
    vi.mocked(withReentryGuard).mockResolvedValueOnce(undefined);

    await handleSave("main");

    // Should not throw; guardResult === undefined triggers warning
  });

  it("shows non-Error rejection as string in save toast (line 202)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Untitled",
        filePath: null,
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(resolveMissingFileSaveAction).mockReturnValue("save_allowed" as never);
    // Reject with a non-Error
    mockSaveDialog.mockRejectedValueOnce("non-error rejection");

    await handleSave("main");

    expect(toast.error).toHaveBeenCalledWith(
      "Save dialog failed: non-error rejection",
      expect.objectContaining({ action: expect.any(Object) }),
    );
    errorSpy.mockRestore();
  });

  it("uses empty title fallback when tab is not found (line 146)", async () => {
    // Set up so tab is not found in tabs array
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-orphan" },
      tabs: { main: [] }, // No tabs — find returns undefined
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Untitled",
        filePath: null,
        isDirty: true,
        isMissing: false,
      })),
      clearMissing: vi.fn(),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(resolveMissingFileSaveAction).mockReturnValue("save_allowed" as never);
    mockSaveDialog.mockResolvedValueOnce(null); // Cancel dialog

    await handleSave("main");

    // The save dialog is invoked (even though cancelled), confirming buildDefaultSavePath ran
    expect(mockSaveDialog).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSaveAs — additional branches
// ---------------------------------------------------------------------------
describe("handleSaveAs — additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace",
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);
  });

  it("does nothing when no document found", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => null),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    await handleSaveAs("main");

    expect(mockSaveDialog).not.toHaveBeenCalled();
  });

  it("shows toast on Save As dialog error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/test.md",
        isDirty: false,
        isMissing: false,
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockRejectedValueOnce(new Error("Save As dialog crashed"));

    await handleSaveAs("main");

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Save As dialog crashed"),
      expect.objectContaining({ action: expect.any(Object) }),
    );
    errorSpy.mockRestore();
  });

  it("shows non-Error rejection as string in Save As toast (line 267)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/test.md",
        isDirty: false,
        isMissing: false,
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockRejectedValueOnce(42);

    await handleSaveAs("main");

    expect(toast.error).toHaveBeenCalledWith(
      "Save dialog failed: 42",
      expect.objectContaining({ action: expect.any(Object) }),
    );
    errorSpy.mockRestore();
  });

  it("skips move when saveToPath returns false", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/test.md",
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockResolvedValueOnce("/other/location.md");
    mockSaveToPath.mockResolvedValue(false);

    await handleSaveAs("main");

    // moveTabToNewWorkspaceWindow should not be called
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "open_workspace_in_new_window",
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// handleMoveTo — additional branches
// ---------------------------------------------------------------------------
describe("handleMoveTo — additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace",
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);
  });

  it("does nothing when no active tab", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: null },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await handleMoveTo("main");

    expect(mockSaveDialog).not.toHaveBeenCalled();
  });

  it("does nothing when no document found", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => null),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    await handleMoveTo("main");

    expect(mockSaveDialog).not.toHaveBeenCalled();
  });

  it("shows toast on Move To dialog error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/old.md",
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockRejectedValueOnce(new Error("Move dialog error"));

    await handleMoveTo("main");

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Move dialog error"),
      expect.objectContaining({ action: expect.any(Object) }),
    );
    errorSpy.mockRestore();
  });

  it("does not call moveTabToNewWorkspaceWindow when save fails", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/old.md",
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    mockSaveDialog.mockResolvedValueOnce("/new/location.md");
    mockSaveToPath.mockResolvedValue(false);

    await handleMoveTo("main");

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("shows non-Error rejection as string in Move To toast (line 303)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        content: "# Content",
        filePath: "/workspace/old.md",
      })),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    // Reject with a non-Error value
    mockSaveDialog.mockRejectedValueOnce("string rejection");

    await handleMoveTo("main");

    expect(toast.error).toHaveBeenCalledWith(
      "Save dialog failed: string rejection",
      expect.objectContaining({ action: expect.any(Object) }),
    );
    errorSpy.mockRestore();
  });
});
