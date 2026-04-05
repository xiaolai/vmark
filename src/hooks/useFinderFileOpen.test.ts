/**
 * Tests for useFinderFileOpen — Finder file open handling.
 *
 * Covers:
 *   - Event listener registration
 *   - File routing: existing tab, replaceable tab, new tab, new window
 *   - Hot exit restore waiting
 *   - Pending file queue from Rust (cold start path)
 *   - Hot open: app:open-file event when app is already running (warm path)
 *   - Workspace adoption, different workspace (new window)
 *   - Error handling in loadFileIntoTab
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const {
  mockListen,
  mockReadTextFile,
  mockInvoke,
  mockFindExistingTabForPath,
  mockGetReplaceableTab,
  mockOpenWorkspaceWithConfig,
  mockWaitForRestoreComplete,
  mockUseWindowLabel,
} = vi.hoisted(() => ({
  mockListen: vi.fn(() => Promise.resolve(vi.fn())),
  mockReadTextFile: vi.fn(() => Promise.resolve("content")),
  mockInvoke: vi.fn(() => Promise.resolve([])),
  mockFindExistingTabForPath: vi.fn(() => null),
  mockGetReplaceableTab: vi.fn(() => null),
  mockOpenWorkspaceWithConfig: vi.fn(() => Promise.resolve()),
  mockWaitForRestoreComplete: vi.fn(() => Promise.resolve(true)),
  mockUseWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => mockUseWindowLabel(),
}));

const mockSetActiveTab = vi.fn();
const mockCreateTab = vi.fn(() => "new-tab");
const mockUpdateTabPath = vi.fn();
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      setActiveTab: mockSetActiveTab,
      createTab: mockCreateTab,
      updateTabPath: mockUpdateTabPath,
    }),
  },
}));

const mockInitDocument = vi.fn();
const mockLoadContent = vi.fn();
const mockSetLineMetadata = vi.fn();
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      initDocument: mockInitDocument,
      loadContent: mockLoadContent,
      setLineMetadata: mockSetLineMetadata,
    }),
  },
}));

let mockWorkspaceRootPath: string | null = null;
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({ rootPath: mockWorkspaceRootPath }),
  },
}));

vi.mock("@/stores/recentFilesStore", () => ({
  useRecentFilesStore: {
    getState: () => ({ addFile: vi.fn() }),
  },
}));

vi.mock("@/hooks/useReplaceableTab", () => ({
  getReplaceableTab: (...args: unknown[]) => mockGetReplaceableTab(...args),
  findExistingTabForPath: (...args: unknown[]) => mockFindExistingTabForPath(...args),
}));

vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: vi.fn(() => ({ type: "lf", original: "lf" })),
}));

vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...args: unknown[]) => mockOpenWorkspaceWithConfig(...args),
}));

const mockIsWithinRoot = vi.fn(() => false);
vi.mock("@/utils/paths", () => ({
  isWithinRoot: (...args: unknown[]) => mockIsWithinRoot(...args),
}));

vi.mock("@/utils/hotExit/hotExitCoordination", () => ({
  waitForRestoreComplete: (...args: unknown[]) => mockWaitForRestoreComplete(...args),
  RESTORE_WAIT_TIMEOUT_MS: 5000,
}));

vi.mock("@/utils/debug", () => ({
  finderFileOpenWarn: vi.fn(),
  finderFileOpenError: vi.fn(),
}));

import { useFinderFileOpen } from "./useFinderFileOpen";

describe("useFinderFileOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWindowLabel.mockReturnValue("main");
    mockInvoke.mockResolvedValue([]);
    mockWaitForRestoreComplete.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue("file content");
    mockFindExistingTabForPath.mockReturnValue(null);
    mockGetReplaceableTab.mockReturnValue(null);
    mockWorkspaceRootPath = null;
    mockIsWithinRoot.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers event listener on mount", async () => {
    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith("app:open-file", expect.any(Function));
    });
  });

  it("does nothing for non-main windows", () => {
    mockUseWindowLabel.mockReturnValue("doc-0");
    renderHook(() => useFinderFileOpen());
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("cleans up listener on unmount", async () => {
    const mockUnlisten = vi.fn();
    mockListen.mockResolvedValue(mockUnlisten);

    const { unmount } = renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    unmount();
    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("fetches pending file opens after restore", async () => {
    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_pending_file_opens");
    });
  });

  it("activates existing tab when file is already open", async () => {
    mockFindExistingTabForPath.mockReturnValue("existing-tab");
    mockInvoke.mockResolvedValue([{ path: "/test/file.md", workspace_root: null }]);

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockSetActiveTab).toHaveBeenCalledWith("main", "existing-tab");
    });
  });

  it("loads file into replaceable tab", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab" });
    mockInvoke.mockResolvedValue([{ path: "/test/file.md", workspace_root: null }]);

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockLoadContent).toHaveBeenCalled();
      expect(mockUpdateTabPath).toHaveBeenCalledWith("empty-tab", "/test/file.md");
    });
  });

  it("creates new tab for same workspace file", async () => {
    mockInvoke.mockResolvedValue([{ path: "/test/file.md", workspace_root: null }]);

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledWith("main", "/test/file.md");
    });
  });

  it("handles loadFileIntoTab error gracefully for new tab", async () => {
    mockReadTextFile.mockRejectedValue(new Error("read error"));
    mockInvoke.mockResolvedValue([{ path: "/bad/file.md", workspace_root: null }]);

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockInitDocument).toHaveBeenCalledWith("new-tab", "", null);
    });
  });

  it("waits for hot exit restore before processing", async () => {
    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockWaitForRestoreComplete).toHaveBeenCalled();
    });
  });

  it("warns when restore times out but continues processing", async () => {
    const { finderFileOpenWarn } = await import("@/utils/debug");
    mockWaitForRestoreComplete.mockResolvedValue(false);

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(finderFileOpenWarn).toHaveBeenCalledWith(
        "Hot exit restore timed out, proceeding anyway",
      );
    });
  });

  it("opens new window with workspaceRoot when file is in different workspace", async () => {
    mockWorkspaceRootPath = "/current/workspace";
    mockIsWithinRoot.mockReturnValue(false);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pending_file_opens") {
        return Promise.resolve([
          { path: "/other/workspace/file.md", workspace_root: "/other/workspace" },
        ]);
      }
      return Promise.resolve(null);
    });

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
        workspaceRoot: "/other/workspace",
        filePath: "/other/workspace/file.md",
      });
    });
  });

  it("opens file in new window without workspace when file is in different workspace and no workspaceRoot", async () => {
    mockWorkspaceRootPath = "/current/workspace";
    mockIsWithinRoot.mockReturnValue(false);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pending_file_opens") {
        return Promise.resolve([
          { path: "/outside/file.md", workspace_root: null },
        ]);
      }
      return Promise.resolve(null);
    });

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("open_file_in_new_window", {
        path: "/outside/file.md",
      });
    });
  });

  it("opens workspaceWithConfig when replaceable tab exists and workspaceRoot provided", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab" });
    mockWorkspaceRootPath = null; // no current workspace
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pending_file_opens") {
        return Promise.resolve([
          { path: "/new/workspace/file.md", workspace_root: "/new/workspace" },
        ]);
      }
      return Promise.resolve(null);
    });

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/new/workspace");
    });
  });

  it("handles loadFileIntoTab error gracefully for replaceable tab", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab" });
    mockReadTextFile.mockRejectedValue(new Error("read error"));
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pending_file_opens") {
        return Promise.resolve([{ path: "/test/file.md", workspace_root: null }]);
      }
      return Promise.resolve(null);
    });

    // Should not throw
    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockGetReplaceableTab).toHaveBeenCalled();
    });
  });

  it("opens workspaceWithConfig for same-workspace new tab when workspaceRoot and no rootPath", async () => {
    mockWorkspaceRootPath = null;
    mockIsWithinRoot.mockReturnValue(false);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pending_file_opens") {
        return Promise.resolve([
          { path: "/new/workspace/file.md", workspace_root: "/new/workspace" },
        ]);
      }
      return Promise.resolve(null);
    });

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/new/workspace");
      expect(mockCreateTab).toHaveBeenCalledWith("main", "/new/workspace/file.md");
    });
  });

  it("queues events that arrive before restore completes", async () => {
    let resolveRestore!: (value: boolean) => void;
    const restorePromise = new Promise<boolean>((resolve) => {
      resolveRestore = resolve;
    });
    mockWaitForRestoreComplete.mockReturnValue(restorePromise);

    let eventHandler!: (event: { payload: { path: string; workspace_root: string | null } }) => void;
    mockListen.mockImplementation(
      (_event: string, handler: typeof eventHandler) => {
        eventHandler = handler;
        return Promise.resolve(vi.fn());
      },
    );

    renderHook(() => useFinderFileOpen());

    // Wait for listener to be set up
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith("app:open-file", expect.any(Function));
    });

    // Dispatch event before restore is complete — should be queued
    eventHandler({ payload: { path: "/queued/file.md", workspace_root: null } });
    expect(mockCreateTab).not.toHaveBeenCalled();

    // Now let restore complete
    resolveRestore(true);

    await vi.waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledWith("main", "/queued/file.md");
    });
  });

  it("handles error in different-workspace new window invoke gracefully", async () => {
    mockWorkspaceRootPath = "/current/workspace";
    mockIsWithinRoot.mockReturnValue(false);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pending_file_opens") {
        return Promise.resolve([
          { path: "/other/workspace/file.md", workspace_root: "/other/workspace" },
        ]);
      }
      // Throw on the invoke for open_workspace_in_new_window
      return Promise.reject(new Error("window open failed"));
    });

    // Should not throw
    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", expect.any(Object));
    });
  });

  // Regression test: hot open (app already running) was silently dropped because
  // Rust used main_window.emit() (webview-specific) but the hook used global listen().
  // In Tauri v2, webview-specific events are NOT delivered to global listen() —
  // only to currentWindow.listen(). The fix changes Rust to app.emit() (global).
  it("processes app:open-file event when app is already running (hot open)", async () => {
    let eventHandler!: (event: { payload: { path: string; workspace_root: string | null } }) => void;
    mockListen.mockImplementation(
      (_event: string, handler: typeof eventHandler) => {
        eventHandler = handler;
        return Promise.resolve(vi.fn());
      },
    );

    renderHook(() => useFinderFileOpen());

    // Wait for restore to complete and listener to be active
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_pending_file_opens");
    });

    // Simulate Rust firing app:open-file after app is already running (warm path)
    eventHandler({ payload: { path: "/hot/opened/file.md", workspace_root: null } });

    await vi.waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledWith("main", "/hot/opened/file.md");
    });

    // Must also explicitly activate to survive concurrent focus steals
    await vi.waitFor(() => {
      expect(mockSetActiveTab).toHaveBeenCalledWith("main", "new-tab");
    });
  });

  it("explicitly activates new tab after loading (resilient to concurrent focus steals)", async () => {
    mockInvoke.mockResolvedValue([{ path: "/new/file.md", workspace_root: null }]);

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledWith("main", "/new/file.md");
    });

    // setActiveTab must be called AFTER createTab (not relying solely on
    // createTab auto-activation, which can be overridden by concurrent ops)
    await vi.waitFor(() => {
      expect(mockSetActiveTab).toHaveBeenCalledWith("main", "new-tab");
    });
  });

  it("explicitly activates replaceable tab after loading", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab" });
    mockInvoke.mockResolvedValue([{ path: "/new/file.md", workspace_root: null }]);

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(mockUpdateTabPath).toHaveBeenCalledWith("empty-tab", "/new/file.md");
    });

    // Replaceable tab must be explicitly activated after load
    await vi.waitFor(() => {
      expect(mockSetActiveTab).toHaveBeenCalledWith("main", "empty-tab");
    });
  });

  it("recovers the processing chain after an unhandled error in processFileOpen", async () => {
    // First file: findExistingTabForPath throws (uncaught path before the fix)
    let callCount = 0;
    mockFindExistingTabForPath.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("unexpected error");
      }
      return null;
    });

    let handler: ((event: { payload: OpenFilePayload }) => void) | null = null;
    mockListen.mockImplementation((_event: string, cb: (event: { payload: OpenFilePayload }) => void) => {
      handler = cb;
      return Promise.resolve(vi.fn());
    });

    renderHook(() => useFinderFileOpen());

    await vi.waitFor(() => {
      expect(handler).not.toBeNull();
    });

    // First file open — triggers the error
    handler!({ payload: { path: "/fail.md", workspace_root: null } });
    // Second file open — should still work because chain recovered
    handler!({ payload: { path: "/ok.md", workspace_root: null } });

    await vi.waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledWith("main", "/ok.md");
    });
  });
});
