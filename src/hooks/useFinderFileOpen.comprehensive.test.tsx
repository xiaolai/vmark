/**
 * Comprehensive tests for useFinderFileOpen hook
 *
 * Tests: event listener registration, file processing, tab reuse,
 * workspace routing, pending file queue, non-main window skipping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// --- Mocks ---

type OpenFilePayload = { path: string; workspace_root: string | null };
type ListenHandler = (event: { payload: OpenFilePayload }) => void;

let listenHandler: ListenHandler | null = null;
const listenMock = vi.fn(
  (_eventName: string, handler: ListenHandler) => {
    listenHandler = handler;
    return Promise.resolve(() => {
      listenHandler = null;
    });
  }
);

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...(args as [string, ListenHandler])),
}));

const invokeMock = vi.fn(() => Promise.resolve([]));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const mockReadTextFile = vi.fn(() => Promise.resolve("# Content"));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));

let mockWindowLabel = "main";
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => mockWindowLabel,
}));

const mockFindExistingTabForPath = vi.fn(() => null);
const mockGetReplaceableTab = vi.fn(() => null);
vi.mock("@/hooks/useReplaceableTab", () => ({
  getReplaceableTab: (...args: unknown[]) => mockGetReplaceableTab(...args),
  findExistingTabForPath: (...args: unknown[]) => mockFindExistingTabForPath(...args),
}));

const mockOpenWorkspaceWithConfig = vi.fn(() => Promise.resolve());
vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...args: unknown[]) => mockOpenWorkspaceWithConfig(...args),
}));

const mockSetActiveTab = vi.fn();
const mockCreateTab = vi.fn(() => "new-tab-id");
const mockUpdateTabPath = vi.fn();
const mockDetachTab = vi.fn();
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      tabs: { main: [] },
      setActiveTab: mockSetActiveTab,
      createTab: mockCreateTab,
      updateTabPath: mockUpdateTabPath,
      detachTab: mockDetachTab,
    }),
  },
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string, vars?: Record<string, unknown>) => `${key}:${JSON.stringify(vars ?? {})}` },
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

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({ rootPath: null, isWorkspaceMode: false }),
  },
}));

const mockAddFile = vi.fn();
vi.mock("@/stores/recentFilesStore", () => ({
  useRecentFilesStore: {
    getState: () => ({ addFile: mockAddFile }),
  },
}));

vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: () => ({ kind: "lf" }),
}));

vi.mock("@/utils/paths", () => ({
  isWithinRoot: (_root: string, path: string) => path.startsWith("/workspace/"),
}));

const mockWaitForRestoreComplete = vi.fn(() => Promise.resolve(true));
vi.mock("@/utils/hotExit/hotExitCoordination", () => ({
  waitForRestoreComplete: (...args: unknown[]) => mockWaitForRestoreComplete(...args),
  RESTORE_WAIT_TIMEOUT_MS: 5000,
}));

vi.mock("@/utils/debug", () => ({
  finderFileOpenWarn: vi.fn(),
  finderFileOpenError: vi.fn(),
}));

import { useFinderFileOpen } from "./useFinderFileOpen";

function TestComponent() {
  useFinderFileOpen();
  return null;
}

describe("useFinderFileOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenHandler = null;
    mockWindowLabel = "main";
    invokeMock.mockResolvedValue([]);
    mockReadTextFile.mockResolvedValue("# Content");
    mockFindExistingTabForPath.mockReturnValue(null);
    mockGetReplaceableTab.mockReturnValue(null);
  });

  it("registers listener and fetches pending files on main window", async () => {
    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listenMock).toHaveBeenCalledWith("app:open-file", expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith("get_pending_file_opens");
  });

  it("does not register listener on non-main window", async () => {
    mockWindowLabel = "secondary";

    await act(async () => {
      render(<TestComponent />);
    });

    expect(listenMock).not.toHaveBeenCalled();
  });

  it("waits for hot exit restore before processing pending files", async () => {
    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockWaitForRestoreComplete).toHaveBeenCalled();
  });

  it("activates existing tab if file already open", async () => {
    mockFindExistingTabForPath.mockReturnValue("existing-tab");

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate file open event
    await act(async () => {
      listenHandler!({ payload: { path: "/docs/file.md", workspace_root: null } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetActiveTab).toHaveBeenCalledWith("main", "existing-tab");
    expect(mockCreateTab).not.toHaveBeenCalled();
  });

  it("replaces empty tab when available", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab", filePath: null });

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({ payload: { path: "/docs/file.md", workspace_root: null } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockLoadContent).toHaveBeenCalled();
    expect(mockUpdateTabPath).toHaveBeenCalledWith("empty-tab", "/docs/file.md");
    expect(mockCreateTab).not.toHaveBeenCalled();
  });

  it("opens workspace config when replacing tab with workspace_root", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab", filePath: null });

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({
        payload: { path: "/workspace/file.md", workspace_root: "/workspace" },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/workspace");
  });

  it("creates new tab when no replaceable tab and same workspace", async () => {
    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({ payload: { path: "/docs/new.md", workspace_root: null } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreateTab).toHaveBeenCalledWith("main", "/docs/new.md");
    expect(mockInitDocument).toHaveBeenCalled();
  });

  it("processes pending files from cold start", async () => {
    invokeMock.mockResolvedValue([
      { path: "/docs/pending1.md", workspace_root: null },
      { path: "/docs/pending2.md", workspace_root: null },
    ]);

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreateTab).toHaveBeenCalledTimes(2);
  });

  it("detaches orphan tab and toasts on readTextFile failure for new tab", async () => {
    mockReadTextFile.mockRejectedValue(new Error("forbidden path: /docs/broken.md"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({ payload: { path: "/docs/broken.md", workspace_root: null } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Tab is created, then detached after read fails — no empty-content
    // document is left behind, and the user sees a toast with the cause.
    expect(mockCreateTab).toHaveBeenCalled();
    expect(mockInitDocument).not.toHaveBeenCalled();
    expect(mockDetachTab).toHaveBeenCalledWith("main", "new-tab-id");
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("forbidden path")
    );
    expect(mockSetActiveTab).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("toasts and preserves untouched tab on replaceable-tab read failure", async () => {
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab", filePath: null });
    mockReadTextFile.mockRejectedValue(new Error("forbidden path: /docs/broken.md"));

    const { finderFileOpenError } = await import("@/utils/debug");

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({ payload: { path: "/docs/broken.md", workspace_root: null } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Error is logged AND surfaced to the user via toast — no silent no-op.
    expect(finderFileOpenError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load file"),
      "/docs/broken.md",
      expect.any(Error)
    );
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("forbidden path")
    );
    // Tab path must NOT be rewritten to the failed file — the untitled
    // tab stays untitled, ready for the next attempt.
    expect(mockUpdateTabPath).not.toHaveBeenCalled();
    // And we do NOT activate a tab with stale content — short-circuit.
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  it("warns when hot exit restore times out", async () => {
    mockWaitForRestoreComplete.mockResolvedValue(false);
    const { finderFileOpenWarn } = await import("@/utils/debug");

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(finderFileOpenWarn).toHaveBeenCalledWith(
      expect.stringContaining("timed out")
    );
  });

  it("adopts workspace when no current workspace exists and workspace_root provided", async () => {
    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({
        payload: { path: "/new-workspace/file.md", workspace_root: "/new-workspace" },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/new-workspace");
    expect(mockCreateTab).toHaveBeenCalled();
  });

  it("handles init failure gracefully", async () => {
    // Force listen to reject
    listenMock.mockRejectedValueOnce(new Error("listen failed"));
    const { finderFileOpenError } = await import("@/utils/debug");

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(finderFileOpenError).toHaveBeenCalledWith(
      expect.stringContaining("Init failed"),
      expect.any(Error)
    );
    // Reset listen mock
    listenMock.mockImplementation((_eventName: string, handler: ListenHandler) => {
      listenHandler = handler;
      return Promise.resolve(() => { listenHandler = null; });
    });
  });

  it("adds file to recent files on success", async () => {
    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({ payload: { path: "/docs/file.md", workspace_root: null } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAddFile).toHaveBeenCalledWith("/docs/file.md");
  });
});
