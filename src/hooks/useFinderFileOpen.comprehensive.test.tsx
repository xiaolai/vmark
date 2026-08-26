/**
 * Comprehensive tests for useFinderFileOpen hook
 *
 * Tests: event listener registration, file processing, tab reuse,
 * workspace routing, main-only pending queue, targeted document-window opens.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// --- Mocks ---

type OpenFilePayload = {
  path: string;
  workspace_root: string | null;
  target_window_label?: string;
};
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
  listen: (eventName: string, handler: ListenHandler) => listenMock(eventName, handler),
}));

// Every mock below is declared with its real signature. `vi.fn(() => null)`
// infers a return type of exactly `null`, so `mockReturnValue({...})` is a type
// ERROR the runtime never sees — the mock and its subject can then disagree
// silently, which is the whole reason `pnpm lint:test-types` exists.
const invokeMock = vi.fn<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve([]),
);
vi.mock("@tauri-apps/api/core", () => ({
  // Tuple rest, not `(command, args?)`: naming the optional parameter forwards
  // an explicit `undefined` for it, so a one-argument invoke is RECORDED as two
  // and `toHaveBeenCalledWith("cmd")` stops matching. A tuple also satisfies
  // TS2556, which is what an untyped `...args: unknown[]` spread violates.
  invoke: (...args: [command: string, args?: unknown]) => invokeMock(...args),
}));

const mockReadTextFile = vi.fn<(path: string) => Promise<string>>(() =>
  Promise.resolve("# Content"),
);
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (path: string) => mockReadTextFile(path),
}));

let mockWindowLabel = "main";
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => mockWindowLabel,
}));

type ReplaceableTab = { tabId: string; filePath: string | null };
const mockFindExistingTabForPath =
  vi.fn<(windowLabel: string, path: string) => string | null>(() => null);
const mockGetReplaceableTab =
  vi.fn<(windowLabel: string) => ReplaceableTab | null>(() => null);
vi.mock("@/services/tabs/replaceableTab", () => ({
  getReplaceableTab: (windowLabel: string) => mockGetReplaceableTab(windowLabel),
  findExistingTabForPath: (windowLabel: string, path: string) =>
    mockFindExistingTabForPath(windowLabel, path),
}));

const mockOpenWorkspaceWithConfig =
  vi.fn<(rootPath: string, options?: unknown) => Promise<unknown>>(() => Promise.resolve(null));
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...args: [rootPath: string, options?: unknown]) =>
    mockOpenWorkspaceWithConfig(...args),
}));

const mockSetActiveTab = vi.fn();
const mockCreateTab = vi.fn(() => "new-tab-id");
const mockUpdateTabPath = vi.fn();
const mockDetachTab = vi.fn();
const mockGetActiveTab = vi.fn<() => { id: string } | null>(() => null);
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      tabs: { main: [] },
      setActiveTab: mockSetActiveTab,
      createTab: mockCreateTab,
      // loadFileIntoTab re-checks the tab after its await (close-during-read).
      findTabById: vi.fn((id: string) => ({ id })),
      // createNewTabForFile pre-checks whether createTab would deduplicate.
      findTabByPath: vi.fn(() => null),
      updateTabPath: mockUpdateTabPath,
      detachTab: mockDetachTab,
      getActiveTab: mockGetActiveTab,
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

const mockLoadContent = vi.fn();
const mockSetLineMetadata = vi.fn();
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      // One door now: the disk-open ingest creates or replaces.
      ingestExternalContent: mockLoadContent,
      setLineMetadata: mockSetLineMetadata,
    }),
  },
}));

const mockAddFile = vi.fn();
// Configurable, not pinned. This was hardcoded to `rootPath: null`, so the
// whole suite only ever described a window with NO workspace — and the one
// state where reusing the untitled tab destroys something (#1330) could not be
// reached by any test here.
let mockWorkspaceState: { rootPath: string | null; isWorkspaceMode: boolean } = {
  rootPath: null,
  isWorkspaceMode: false,
};
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => mockWorkspaceState,
  },
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

const mockWaitForRestoreComplete =
  vi.fn<(timeoutMs: number) => Promise<boolean>>(() => Promise.resolve(true));
vi.mock("@/services/persistence/hotExit/hotExitCoordination", () => ({
  waitForRestoreComplete: (timeoutMs: number) => mockWaitForRestoreComplete(timeoutMs),
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
    mockWorkspaceState = { rootPath: null, isWorkspaceMode: false };
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

  it("registers a listener without fetching the pending queue on a document window", async () => {
    mockWindowLabel = "doc-0";

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listenMock).toHaveBeenCalledWith("app:open-file", expect.any(Function));
    expect(invokeMock).not.toHaveBeenCalledWith("get_pending_file_opens");
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
    mockWindowLabel = "doc-0";
    mockFindExistingTabForPath.mockReturnValue("existing-tab");

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate file open event
    await act(async () => {
      listenHandler!({
        payload: {
          path: "/docs/file.md",
          workspace_root: null,
          target_window_label: "doc-0",
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetActiveTab).toHaveBeenCalledWith("doc-0", "existing-tab");
    expect(mockCreateTab).not.toHaveBeenCalled();
  });

  it("ignores a hot-open event targeted to another document window", async () => {
    mockWindowLabel = "doc-1";

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({
        payload: {
          path: "/docs/wrong-window.md",
          workspace_root: null,
          target_window_label: "doc-0",
        },
      });
      await Promise.resolve();
    });

    expect(mockCreateTab).not.toHaveBeenCalled();
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  it("ignores an untargeted event outside the main window", async () => {
    mockWindowLabel = "doc-0";

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({ payload: { path: "/docs/legacy.md", workspace_root: null } });
      await Promise.resolve();
    });

    expect(mockCreateTab).not.toHaveBeenCalled();
    expect(mockSetActiveTab).not.toHaveBeenCalled();
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

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/workspace", {
      windowLabel: "main",
    });
  });

  // #1330 — the reported scenario, end to end through the real branch resolver
  // and dispatcher: File → Open Workspace leaves a window with a file tree and
  // ONE clean untitled tab, and a double-click on a file from another folder
  // used to consume that tab and re-root the window, so the tree disappeared
  // with no tab left to navigate back from.
  it("keeps the open workspace when a file from elsewhere arrives", async () => {
    mockWorkspaceState = { rootPath: "/workspace", isWorkspaceMode: true };
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab", filePath: null });

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      // `isWithinRoot` is mocked to accept only /workspace/*, so this file is
      // outside the open workspace — the same relation as C:\Users\…\Desktop
      // against D:\notes in the report.
      listenHandler!({
        payload: { path: "/elsewhere/note.md", workspace_root: "/elsewhere" },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    // The untitled tab is left alone too: it was never the window's only claim
    // on the workspace, but consuming it would still have lost the user's tab.
    expect(mockUpdateTabPath).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/elsewhere",
      filePath: "/elsewhere/note.md",
    });
  });

  it("still reuses the untitled tab for a file inside the open workspace", async () => {
    // The other half of the guard: the fix must not push same-workspace opens
    // into a new window. It lands here, and still does not re-root — the
    // incoming root is the file's PARENT, a subfolder of the workspace.
    mockWorkspaceState = { rootPath: "/workspace", isWorkspaceMode: true };
    mockGetReplaceableTab.mockReturnValue({ tabId: "empty-tab", filePath: null });

    await act(async () => {
      render(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      listenHandler!({
        payload: { path: "/workspace/sub/note.md", workspace_root: "/workspace/sub" },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    expect(mockUpdateTabPath).toHaveBeenCalledWith("empty-tab", "/workspace/sub/note.md");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_workspace_in_new_window",
      expect.anything(),
    );
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
    expect(mockLoadContent).toHaveBeenCalled();
  });

  it("finishes a Rust queue batch drained before the hook unmounts", async () => {
    let resolvePending!: (files: OpenFilePayload[]) => void;
    invokeMock.mockImplementation((command: string) =>
      command === "get_pending_file_opens"
        ? new Promise((resolve) => { resolvePending = resolve; })
        : command === "get_file_size_bytes" ? Promise.resolve(0) : Promise.resolve()
    );

    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(<TestComponent />));
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      resolvePending([{ path: "/drained-before-unmount.md", workspace_root: null }]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreateTab).toHaveBeenCalledWith("main", "/drained-before-unmount.md");
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
    expect(mockLoadContent).not.toHaveBeenCalled();
    expect(mockDetachTab).toHaveBeenCalledWith("main", "new-tab-id");
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("forbidden path"),
      expect.objectContaining({ action: expect.any(Object) }),
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
      expect.stringContaining("forbidden path"),
      expect.objectContaining({ action: expect.any(Object) }),
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

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/new-workspace", {
      windowLabel: "main",
    });
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
