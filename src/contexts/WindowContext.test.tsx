/**
 * WindowContext Tests
 *
 * Tests for the WindowProvider, useWindowLabel, and useIsDocumentWindow hooks.
 * Covers: context provider/consumer pattern, label detection, error boundaries,
 * and settings/doc-window branching.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

// --- Mocks (must precede imports) ---

const {
  mockEmit,
  mockListen,
  mockCreateTab,
  mockGetTabsByWindow,
  mockInitDocument,
  mockSetLineMetadata,
  mockAddFile,
  mockRehydrate,
  mockCloseWorkspace,
  mockDetachTab,
  mockRemoveDocument,
  mockCreateTransferredTab,
  mockUpdateTabTitle,
  mockWorkspaceState,
} = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  mockListen: vi.fn(() => Promise.resolve(vi.fn())),
  mockCreateTab: vi.fn(() => "tab-1"),
  mockGetTabsByWindow: vi.fn(() => [] as unknown[]),
  mockInitDocument: vi.fn(),
  mockSetLineMetadata: vi.fn(),
  mockAddFile: vi.fn(),
  mockRehydrate: vi.fn(),
  mockCloseWorkspace: vi.fn(),
  mockDetachTab: vi.fn(),
  mockRemoveDocument: vi.fn(),
  mockCreateTransferredTab: vi.fn(() => "tab-t"),
  mockUpdateTabTitle: vi.fn(),
  mockWorkspaceState: {
    rootPath: null as string | null,
    isWorkspaceMode: false,
  },
}));

let mockWindowLabel = "main";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: mockWindowLabel,
    emit: mockEmit,
    listen: mockListen,
    close: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(() => Promise.resolve("")),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("../stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      initDocument: mockInitDocument,
      setLineMetadata: mockSetLineMetadata,
      removeDocument: mockRemoveDocument,
    }),
  },
}));

vi.mock("../stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      createTab: mockCreateTab,
      getTabsByWindow: mockGetTabsByWindow,
      createTransferredTab: mockCreateTransferredTab,
      updateTabTitle: mockUpdateTabTitle,
      detachTab: mockDetachTab,
    }),
  },
}));

vi.mock("../stores/recentFilesStore", () => ({
  useRecentFilesStore: {
    getState: () => ({ addFile: mockAddFile }),
  },
}));

vi.mock("../stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({
      rootPath: mockWorkspaceState.rootPath,
      isWorkspaceMode: mockWorkspaceState.isWorkspaceMode,
      closeWorkspace: mockCloseWorkspace,
    }),
    persist: { rehydrate: mockRehydrate },
  },
}));

vi.mock("../utils/workspaceStorage", () => ({
  setCurrentWindowLabel: vi.fn(),
  migrateWorkspaceStorage: vi.fn(),
  getWorkspaceStorageKey: vi.fn((label: string) => `vmark-workspace:${label}`),
  findActiveWorkspaceLabel: vi.fn(() => null),
}));

vi.mock("../utils/openPolicy", () => ({
  resolveWorkspaceRootForExternalFile: vi.fn(() => null),
}));

vi.mock("../utils/paths", () => ({
  isWithinRoot: vi.fn(() => false),
}));

vi.mock("../hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/hooks/useWorkspaceSync", () => ({
  useWorkspaceSync: vi.fn(),
}));

vi.mock("../utils/linebreakDetection", () => ({
  detectLinebreaks: vi.fn(() => ({ type: "lf" })),
}));

vi.mock("@/utils/debug", () => ({
  windowCloseWarn: vi.fn(),
  windowContextError: vi.fn(),
}));

// Now import components under test
import { WindowProvider, useWindowLabel, useIsDocumentWindow } from "./WindowContext";
import { windowContextError as _windowContextError } from "@/utils/debug";
const mockWindowContextError = vi.mocked(_windowContextError);

// Helper wrapper
function _Wrapper({ children }: { children: ReactNode }) {
  return <WindowProvider>{children}</WindowProvider>;
}

describe("WindowContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowLabel = "main";
    mockGetTabsByWindow.mockReturnValue([]);
    mockCreateTab.mockReturnValue("tab-1");
    mockCreateTransferredTab.mockReturnValue("tab-t");
    mockListen.mockImplementation(() => Promise.resolve(vi.fn()));
    mockWorkspaceState.rootPath = null;
    mockWorkspaceState.isWorkspaceMode = false;
    // Reset location.search
    Object.defineProperty(globalThis, "location", {
      value: { search: "" },
      writable: true,
      configurable: true,
    });
  });

  describe("WindowProvider", () => {
    it("renders children after initialization", async () => {
      render(
        <WindowProvider>
          <div data-testid="child">Hello</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });
    });

    it("emits ready event to Rust after init", async () => {
      vi.useFakeTimers();

      render(
        <WindowProvider>
          <div>content</div>
        </WindowProvider>,
      );

      // Allow async init to complete
      await vi.advanceTimersByTimeAsync(200);

      expect(mockEmit).toHaveBeenCalledWith("ready", "main");

      vi.useRealTimers();
    });

    it("creates initial tab and empty document for main window", async () => {
      render(
        <WindowProvider>
          <div>content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockCreateTab).toHaveBeenCalledWith("main", null);
        expect(mockInitDocument).toHaveBeenCalledWith("tab-1", "", null);
      });
    });

    it("skips document init for settings window", async () => {
      mockWindowLabel = "settings";

      render(
        <WindowProvider>
          <div data-testid="child">Settings</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });

      // Should not create tabs for settings window
      expect(mockCreateTab).not.toHaveBeenCalled();
    });

    it("skips document init when tabs already exist", async () => {
      mockGetTabsByWindow.mockReturnValue([{ id: "existing-tab" }]);

      render(
        <WindowProvider>
          <div>content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockCreateTab).not.toHaveBeenCalled();
      });
    });

    it("sets up tab:transfer and tab:remove-by-id listeners for doc windows", async () => {
      render(
        <WindowProvider>
          <div>content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledWith("tab:transfer", expect.any(Function));
        expect(mockListen).toHaveBeenCalledWith("tab:remove-by-id", expect.any(Function));
      });
    });

    it("does not set up tab listeners for settings window", async () => {
      mockWindowLabel = "settings";

      render(
        <WindowProvider>
          <div>content</div>
        </WindowProvider>,
      );

      // Wait for render to settle
      await waitFor(() => {
        expect(screen.getByText("content")).toBeInTheDocument();
      });

      // tab:transfer listener should not be set for settings windows
      const transferCalls = mockListen.mock.calls.filter(
        (call) => call[0] === "tab:transfer",
      );
      expect(transferCalls).toHaveLength(0);
    });

    it("rehydrates workspace store on init", async () => {
      render(
        <WindowProvider>
          <div>content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockRehydrate).toHaveBeenCalled();
      });
    });

    it("closes workspace when main window opens with no file and no workspace param", async () => {
      mockWindowLabel = "main";

      render(
        <WindowProvider>
          <div>content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockCloseWorkspace).toHaveBeenCalled();
      });
    });
  });

  describe("useWindowLabel", () => {
    it("returns the window label from context", async () => {
      let label: string | undefined;

      function Consumer() {
        label = useWindowLabel();
        return <div>{label}</div>;
      }

      render(
        <WindowProvider>
          <Consumer />
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(label).toBe("main");
      });
    });

    it("throws when used outside WindowProvider", () => {
      // Suppress React error boundary console output
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useWindowLabel());
      }).toThrow("useWindowLabel must be used within WindowProvider");

      consoleSpy.mockRestore();
    });
  });

  describe("useIsDocumentWindow", () => {
    it("returns true for main window", async () => {
      let isDoc: boolean | undefined;

      function Consumer() {
        isDoc = useIsDocumentWindow();
        return <div>{String(isDoc)}</div>;
      }

      render(
        <WindowProvider>
          <Consumer />
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(isDoc).toBe(true);
      });
    });

    it("returns true for doc-* windows", async () => {
      mockWindowLabel = "doc-123";
      let isDoc: boolean | undefined;

      function Consumer() {
        isDoc = useIsDocumentWindow();
        return <div>{String(isDoc)}</div>;
      }

      render(
        <WindowProvider>
          <Consumer />
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(isDoc).toBe(true);
      });
    });

    it("returns false for settings window", async () => {
      mockWindowLabel = "settings";
      let isDoc: boolean | undefined;

      function Consumer() {
        isDoc = useIsDocumentWindow();
        return <div>{String(isDoc)}</div>;
      }

      render(
        <WindowProvider>
          <Consumer />
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(isDoc).toBe(false);
      });
    });

    it("throws when used outside WindowProvider", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useIsDocumentWindow());
      }).toThrow("useIsDocumentWindow must be used within WindowProvider");

      consoleSpy.mockRestore();
    });
  });

  describe("WindowProvider — doc-* window", () => {
    it("creates tab and document for doc-* window", async () => {
      mockWindowLabel = "doc-456";

      render(
        <WindowProvider>
          <div>content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockCreateTab).toHaveBeenCalledWith("doc-456", null);
        expect(mockInitDocument).toHaveBeenCalledWith("tab-1", "", null);
      });
    });
  });

  describe("WindowProvider — settings window workspace", () => {
    it("looks for active workspace label for settings window", async () => {
      mockWindowLabel = "settings";

      render(
        <WindowProvider>
          <div data-testid="child">Settings</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });
    });
  });

  describe("WindowProvider — error handling", () => {
    it("still sets isReady on init error", async () => {
      // Force an error by making getCurrentWebviewWindow throw
      const origMock = vi.mocked(mockListen);
      origMock.mockImplementationOnce(() => Promise.reject(new Error("test error")));

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <WindowProvider>
          <div data-testid="child">Content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });

      errorSpy.mockRestore();
    });
  });

  describe("WindowProvider — file loading from URL params", () => {
    it("loads file content from URL file param", async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockResolvedValue("# File Content");

      Object.defineProperty(globalThis, "location", {
        value: { search: "?file=/docs/test.md" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockCreateTab).toHaveBeenCalledWith("main", "/docs/test.md");
      });

      await waitFor(() => {
        expect(readTextFile).toHaveBeenCalledWith("/docs/test.md");
        expect(mockInitDocument).toHaveBeenCalled();
        expect(mockSetLineMetadata).toHaveBeenCalled();
        expect(mockAddFile).toHaveBeenCalledWith("/docs/test.md");
      });
    });

    it("initializes empty document when file read fails", async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockRejectedValue(new Error("not found"));
      const { toast } = await import("sonner");

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      Object.defineProperty(globalThis, "location", {
        value: { search: "?file=/docs/missing.md" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockInitDocument).toHaveBeenCalledWith(expect.any(String), "", null);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("missing.md"));
      });

      errorSpy.mockRestore();
    });

    it("opens workspace from workspaceRoot URL param", async () => {
      const { openWorkspaceWithConfig } = await import("../hooks/openWorkspaceWithConfig");

      Object.defineProperty(globalThis, "location", {
        value: { search: "?workspaceRoot=/projects/myapp&file=/projects/myapp/README.md" },
        writable: true,
        configurable: true,
      });

      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockResolvedValue("# README");

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(openWorkspaceWithConfig).toHaveBeenCalledWith("/projects/myapp");
      });

      // The file tab MUST still be created when workspaceRoot AND file are
      // both present — guards against the workspace-mode skip in the
      // else-branch ever bleeding into the file-loading paths.
      await waitFor(() => {
        expect(mockCreateTab).toHaveBeenCalledWith("main", "/projects/myapp/README.md");
        expect(mockInitDocument).toHaveBeenCalledWith(
          "tab-1",
          "# README",
          "/projects/myapp/README.md",
        );
      });
    });

    it("does NOT create a blank untitled tab when entering a workspace with no file", async () => {
      // Dock-icon reopen flow: Rust passes ?workspaceRoot=... with no
      // file. The file explorer is the entry point; a forced blank tab
      // would feel orphaned. Hot-exit / lastOpenTabs restore can still
      // populate tabs after init.
      const { openWorkspaceWithConfig } = await import("../hooks/openWorkspaceWithConfig");

      Object.defineProperty(globalThis, "location", {
        value: { search: "?workspaceRoot=/projects/myapp" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(openWorkspaceWithConfig).toHaveBeenCalledWith("/projects/myapp");
      });

      // The else-branch blank-tab fallback must be skipped in workspace mode
      expect(mockCreateTab).not.toHaveBeenCalled();
      expect(mockInitDocument).not.toHaveBeenCalled();
    });

    it("handles multiple files from files URL param", async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockResolvedValue("# content");

      const files = JSON.stringify(["/docs/a.md", "/docs/b.md"]);
      Object.defineProperty(globalThis, "location", {
        value: { search: `?files=${encodeURIComponent(files)}` },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockCreateTab).toHaveBeenCalledTimes(2);
        expect(readTextFile).toHaveBeenCalledWith("/docs/a.md");
        expect(readTextFile).toHaveBeenCalledWith("/docs/b.md");
      });
    });

    it("handles invalid JSON in files param gracefully", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      Object.defineProperty(globalThis, "location", {
        value: { search: "?files=not-json" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });

      // Should still create a default empty tab (falls through to else branch)
      await waitFor(() => {
        expect(mockCreateTab).toHaveBeenCalled();
        expect(mockInitDocument).toHaveBeenCalledWith(expect.any(String), "", null);
      });

      errorSpy.mockRestore();
    });

    it("handles file read failure in multi-file mode", async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile)
        .mockResolvedValueOnce("# good content")
        .mockRejectedValueOnce(new Error("read error"));
      const { toast } = await import("sonner");

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const files = JSON.stringify(["/docs/good.md", "/docs/bad.md"]);
      Object.defineProperty(globalThis, "location", {
        value: { search: `?files=${encodeURIComponent(files)}` },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        // First file succeeded, second failed
        expect(mockCreateTab).toHaveBeenCalledTimes(2);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("bad.md"));
        // Failed file still gets empty document
        expect(mockInitDocument).toHaveBeenCalledWith(expect.any(String), "", null);
      });

      errorSpy.mockRestore();
    });
  });

  describe("WindowProvider — doc-* window clears localStorage", () => {
    it("clears persisted workspace state for doc-* window", async () => {
      mockWindowLabel = "doc-789";
      const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(removeItemSpy).toHaveBeenCalledWith("vmark-workspace:doc-789");
      });

      removeItemSpy.mockRestore();
    });
  });

  describe("WindowProvider — settings window uses active workspace label", () => {
    it("sets current window label to active workspace label for settings", async () => {
      mockWindowLabel = "settings";
      const { findActiveWorkspaceLabel, setCurrentWindowLabel } = await import("../utils/workspaceStorage");
      vi.mocked(findActiveWorkspaceLabel).mockReturnValue("main");

      render(
        <WindowProvider>
          <div data-testid="child">settings</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        // Should first call with "settings", then with "main" (active workspace)
        expect(setCurrentWindowLabel).toHaveBeenCalledWith("settings");
        expect(setCurrentWindowLabel).toHaveBeenCalledWith("main");
      });
    });
  });

  describe("WindowProvider — tab transfer handling", () => {
    it("handles tab transfer from URL param", async () => {
      vi.useFakeTimers();
      mockWindowLabel = "doc-new";
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue({
        tabId: "transferred-tab",
        title: "Transferred",
        content: "# Transferred content",
        filePath: "/docs/transferred.md",
        savedContent: "# Transferred content",
        workspaceRoot: null,
      });

      Object.defineProperty(globalThis, "location", {
        value: { search: "?transfer=true" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await vi.advanceTimersByTimeAsync(200);

      expect(invoke).toHaveBeenCalledWith("claim_tab_transfer", { windowLabel: "doc-new" });

      vi.useRealTimers();
    });
  });

  describe("WindowProvider — runtime tab transfer/remove listeners", () => {
    it("applies runtime tab:transfer event payload", async () => {
      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });

      // Find the tab:transfer listener callback
      await waitFor(() => {
        const transferCall = mockListen.mock.calls.find(
          (call: unknown[]) => call[0] === "tab:transfer",
        );
        expect(transferCall).toBeDefined();
      });

      const transferCall = mockListen.mock.calls.find(
        (call: unknown[]) => call[0] === "tab:transfer",
      );
      const transferHandler = transferCall![1];
      // Invoke the runtime transfer handler
      await transferHandler({
        payload: {
          tabId: "runtime-tab",
          title: "Runtime Tab",
          content: "# Runtime",
          filePath: "/docs/runtime.md",
          savedContent: "# Runtime",
          workspaceRoot: null,
        },
      });

      expect(mockCreateTransferredTab).toHaveBeenCalled();
    });

    it("handles runtime tab:transfer error gracefully", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockCreateTransferredTab.mockImplementationOnce(() => {
        throw new Error("transfer fail");
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        const transferCall = mockListen.mock.calls.find(
          (call: unknown[]) => call[0] === "tab:transfer",
        );
        expect(transferCall).toBeDefined();
      });

      const transferCall = mockListen.mock.calls.find(
        (call: unknown[]) => call[0] === "tab:transfer",
      );
      const transferHandler = transferCall![1];

      await transferHandler({
        payload: {
          tabId: "fail-tab",
          title: "Fail",
          content: "",
          filePath: null,
          savedContent: "",
          workspaceRoot: null,
        },
      });

      expect(mockWindowContextError).toHaveBeenCalledWith(
        expect.stringContaining("Failed to apply runtime tab transfer"),
        expect.any(Error),
      );

      errorSpy.mockRestore();
    });

    it("invokes tab:remove-by-id handler to detach tab", async () => {
      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        const removeCall = mockListen.mock.calls.find(
          (call: unknown[]) => call[0] === "tab:remove-by-id",
        );
        expect(removeCall).toBeDefined();
      });

      const removeCall = mockListen.mock.calls.find(
        (call: unknown[]) => call[0] === "tab:remove-by-id",
      );
      const removeHandler = removeCall![1];

      // Make getTabsByWindow return remaining tabs so window doesn't close
      mockGetTabsByWindow.mockReturnValue([{ id: "other-tab" }]);

      removeHandler({ payload: { tabId: "tab-to-remove" } });

      await waitFor(() => {
        expect(mockDetachTab).toHaveBeenCalledWith("main", "tab-to-remove");
      });
    });

    it("closes doc window when last tab is removed", async () => {
      mockWindowLabel = "doc-close";
      const { invoke } = await import("@tauri-apps/api/core");

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        const removeCall = mockListen.mock.calls.find(
          (call: unknown[]) => call[0] === "tab:remove-by-id",
        );
        expect(removeCall).toBeDefined();
      });

      const removeCall = mockListen.mock.calls.find(
        (call: unknown[]) => call[0] === "tab:remove-by-id",
      );
      const removeHandler = removeCall![1];

      // No remaining tabs after removal
      mockGetTabsByWindow.mockReturnValue([]);

      removeHandler({ payload: { tabId: "last-tab" } });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("close_window", { label: "doc-close" });
      });
    });

    it("cleans up listeners on unmount", async () => {
      const unlistenFn = vi.fn();
      mockListen.mockResolvedValue(unlistenFn);

      const { unmount } = render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      // Wait for listen() promises to resolve so unlisten refs are stored
      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(2);
      });
      // Flush microtasks so .then() callbacks assign unlisten/unlistenRemove
      await new Promise((r) => setTimeout(r, 0));

      unmount();

      // unlisten should be called for both tab:transfer and tab:remove-by-id
      expect(unlistenFn).toHaveBeenCalled();
    });
  });

  describe("WindowProvider — transfer with workspace root fallback", () => {
    it("uses file path parent as workspace root fallback in applyTabTransferData", async () => {
      vi.useFakeTimers();
      mockWindowLabel = "doc-fb";
      const { invoke } = await import("@tauri-apps/api/core");
      const { resolveWorkspaceRootForExternalFile } = await import("../utils/openPolicy");
      vi.mocked(resolveWorkspaceRootForExternalFile).mockReturnValue("/docs");
      const { openWorkspaceWithConfig } = await import("../hooks/openWorkspaceWithConfig");

      vi.mocked(invoke).mockResolvedValue({
        tabId: "t1",
        title: "T1",
        content: "# Content",
        filePath: "/docs/file.md",
        savedContent: "# Content",
        workspaceRoot: null, // no explicit workspace root
      });

      Object.defineProperty(globalThis, "location", {
        value: { search: "?transfer=true" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await vi.advanceTimersByTimeAsync(200);

      // Should derive workspace from file path
      expect(resolveWorkspaceRootForExternalFile).toHaveBeenCalledWith("/docs/file.md");
      expect(openWorkspaceWithConfig).toHaveBeenCalledWith("/docs");

      vi.useRealTimers();
    });
  });

  describe("WindowProvider — tab transfer error in init", () => {
    it("catches tab transfer error and continues normal init", async () => {
      vi.useFakeTimers();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValueOnce(new Error("transfer claim failed"));

      Object.defineProperty(globalThis, "location", {
        value: { search: "?transfer=true" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await vi.advanceTimersByTimeAsync(200);

      expect(mockWindowContextError).toHaveBeenCalledWith(
        expect.stringContaining("Failed to claim tab transfer"),
        expect.any(Error),
      );
      // Should still create a default tab
      expect(mockCreateTab).toHaveBeenCalled();

      errorSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("WindowProvider — file within active workspace", () => {
    it("skips workspace resolution when file is within active workspace root", async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockResolvedValue("# Inside workspace");
      const { isWithinRoot } = await import("../utils/paths");
      vi.mocked(isWithinRoot).mockReturnValue(true);

      // Set workspace store to have an active root
      mockWorkspaceState.rootPath = "/projects";
      mockWorkspaceState.isWorkspaceMode = true;

      Object.defineProperty(globalThis, "location", {
        value: { search: "?file=/projects/src/test.md" },
        writable: true,
        configurable: true,
      });

      const { openWorkspaceWithConfig } = await import("../hooks/openWorkspaceWithConfig");

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(isWithinRoot).toHaveBeenCalledWith("/projects", "/projects/src/test.md");
        // Should NOT call openWorkspaceWithConfig since file is within active workspace
        expect(openWorkspaceWithConfig).not.toHaveBeenCalled();
        expect(mockCloseWorkspace).not.toHaveBeenCalled();
      });

      // Restore
      mockWorkspaceState.rootPath = null;
      mockWorkspaceState.isWorkspaceMode = false;
    });

    it("does not close workspace for doc-* windows when no derived root", async () => {
      mockWindowLabel = "doc-ext";
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockResolvedValue("# External");
      const { resolveWorkspaceRootForExternalFile } = await import("../utils/openPolicy");
      vi.mocked(resolveWorkspaceRootForExternalFile).mockReturnValue(null);

      Object.defineProperty(globalThis, "location", {
        value: { search: "?file=/tmp/external.md" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        // For doc-* windows (not main), closeWorkspace should NOT be called
        // when resolveWorkspaceRootForExternalFile returns null
        expect(mockCloseWorkspace).not.toHaveBeenCalled();
      });
    });
  });

  describe("WindowProvider — openWorkspaceWithConfig failure", () => {
    it("continues when workspace config open fails for URL param", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { openWorkspaceWithConfig } = await import("../hooks/openWorkspaceWithConfig");
      vi.mocked(openWorkspaceWithConfig).mockRejectedValueOnce(new Error("config failed"));

      Object.defineProperty(globalThis, "location", {
        value: { search: "?workspaceRoot=/bad/workspace" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockWindowContextError).toHaveBeenCalledWith(
          expect.stringContaining("Failed to open workspace from URL param"),
          expect.any(Error),
        );
      });

      errorSpy.mockRestore();
    });
  });

  describe("WindowProvider — workspace resolution for external file", () => {
    it("derives workspace root from file path when no workspace is active", async () => {
      const { resolveWorkspaceRootForExternalFile } = await import("../utils/openPolicy");
      vi.mocked(resolveWorkspaceRootForExternalFile).mockReturnValue("/docs");
      const { openWorkspaceWithConfig } = await import("../hooks/openWorkspaceWithConfig");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockResolvedValue("# content");

      Object.defineProperty(globalThis, "location", {
        value: { search: "?file=/docs/test.md" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(resolveWorkspaceRootForExternalFile).toHaveBeenCalledWith("/docs/test.md");
        expect(openWorkspaceWithConfig).toHaveBeenCalledWith("/docs");
      });
    });

    it("closes workspace for main window when file resolves to no workspace root", async () => {
      const { resolveWorkspaceRootForExternalFile } = await import("../utils/openPolicy");
      vi.mocked(resolveWorkspaceRootForExternalFile).mockReturnValue(null);
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      vi.mocked(readTextFile).mockResolvedValue("# content");

      Object.defineProperty(globalThis, "location", {
        value: { search: "?file=/tmp/orphan.md" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(mockCloseWorkspace).toHaveBeenCalled();
      });
    });
  });

  describe("WindowProvider — init error handling", () => {
    it("still renders children when init throws (catch block)", async () => {
      // Make migrateWorkspaceStorage throw to trigger the init catch block
      const { migrateWorkspaceStorage } = await import("../utils/workspaceStorage");
      vi.mocked(migrateWorkspaceStorage).mockImplementation(() => {
        throw new Error("migration boom");
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <WindowProvider>
          <div data-testid="child">recovered</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });

      // Should have logged the error
      expect(mockWindowContextError).toHaveBeenCalledWith(
        expect.stringContaining("Init failed"),
        expect.any(Error),
      );

      // The ready event is called via setTimeout; wait for it
      await waitFor(() => {
        expect(mockEmit).toHaveBeenCalledWith("ready", "main");
      });

      consoleSpy.mockRestore();
      vi.mocked(migrateWorkspaceStorage).mockImplementation(() => {});
    });

    it("handles listen failure for tab removal gracefully", async () => {
      // Ensure migrateWorkspaceStorage does not throw (reset from prior test)
      const { migrateWorkspaceStorage } = await import("../utils/workspaceStorage");
      vi.mocked(migrateWorkspaceStorage).mockImplementation(() => {});

      // Make listen reject ONLY for the tab:remove-by-id event
      mockListen.mockImplementation((event: string) => {
        if (event === "tab:remove-by-id") {
          return Promise.reject(new Error("listen failed"));
        }
        return Promise.resolve(vi.fn());
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });

      // Give time for the listen promise to reject
      await new Promise((r) => setTimeout(r, 150));

      expect(mockWindowContextError).toHaveBeenCalledWith(
        expect.stringContaining("tab removal listener"),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("removeTabFromWindow — close_window error path", () => {
    it("logs warning when close_window invoke fails", async () => {
      mockWindowLabel = "doc-1";
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "close_window") return Promise.reject(new Error("close failed"));
        if (cmd === "claim_tab_transfer") return Promise.resolve(null);
        return Promise.resolve(null);
      });
      // After removing a tab, getTabsByWindow returns empty -> triggers close_window
      mockGetTabsByWindow.mockReturnValue([]);

      // Need to render and trigger removeTabFromWindow via the tab-removed event
      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("child")).toBeInTheDocument();
      });

      // Find the tab-removed listener callback
      const tabRemovedCall = mockListen.mock.calls.find(
        (call: unknown[]) => call[0] === "tab-removed",
      );
      if (tabRemovedCall) {
        const handler = tabRemovedCall[1] as (event: { payload: { windowLabel: string; tabId: string } }) => void;
        await handler({ payload: { windowLabel: "doc-1", tabId: "tab-1" } });

        // Give time for async operations
        await new Promise((r) => setTimeout(r, 50));

        const { windowCloseWarn } = await import("../utils/debug");
        expect(windowCloseWarn).toHaveBeenCalled();
      }

      vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
    });
  });

  describe("WindowProvider — cancelled listener callback paths", () => {
    it("returns early in tab:transfer callback when cancelled (component unmounted before event fires)", async () => {
      // This covers line 334: `if (cancelled) return;` inside the tab:transfer listener callback
      // We need to: register the listener, unmount (sets cancelled=true), then fire the listener callback
      let transferCallback: ((event: { payload: unknown }) => void) | null = null;

      mockListen.mockImplementation((event: string, cb: (e: unknown) => void) => {
        if (event === "tab:transfer") {
          transferCallback = cb as (event: { payload: unknown }) => void;
        }
        return Promise.resolve(vi.fn());
      });

      const { unmount } = render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      // Wait for listeners to be registered
      await waitFor(() => {
        expect(transferCallback).not.toBeNull();
      });

      // Unmount sets cancelled = true
      unmount();

      // Fire the tab:transfer callback AFTER unmount — should return early (line 334)
      // The applyTabTransferData should NOT be called
      if (transferCallback) {
        await transferCallback({
          payload: {
            tabId: "late-tab",
            title: "Late",
            content: "# Late",
            filePath: null,
            savedContent: "# Late",
            workspaceRoot: null,
          },
        });
      }

      // applyTabTransferData calls createTransferredTab internally
      // Since cancelled=true, it returns early so createTransferredTab is not called
      expect(mockCreateTransferredTab).not.toHaveBeenCalled();
    });

    it("returns early in tab:remove-by-id callback when cancelled", async () => {
      // This covers line 352: `if (cancelled) return;` inside the tab:remove-by-id callback
      let removeCallback: ((event: { payload: { tabId: string } }) => void) | null = null;

      mockListen.mockImplementation((event: string, cb: (e: unknown) => void) => {
        if (event === "tab:remove-by-id") {
          removeCallback = cb as (event: { payload: { tabId: string } }) => void;
        }
        return Promise.resolve(vi.fn());
      });

      const { unmount } = render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      // Wait for listeners to be registered
      await waitFor(() => {
        expect(removeCallback).not.toBeNull();
      });

      // Unmount sets cancelled = true
      unmount();

      // Fire the tab:remove-by-id callback AFTER unmount — should return early (line 352)
      if (removeCallback) {
        removeCallback({ payload: { tabId: "stale-tab" } });
      }

      // removeTransferredTabData calls detachTab internally
      // Since cancelled=true, it returns early so detachTab is not called
      await new Promise((r) => setTimeout(r, 50));
      expect(mockDetachTab).not.toHaveBeenCalled();
    });

    it("calls unlistenRemove immediately when cancelled=true before tab:remove-by-id listen resolves", async () => {
      // This covers line 357: `if (cancelled) { fn(); }` for the unlistenRemove path
      let resolveRemove!: (fn: () => void) => void;
      const removeListenPromise = new Promise<() => void>((resolve) => {
        resolveRemove = resolve;
      });
      const unlistenRemoveFn = vi.fn();

      mockListen.mockImplementation((event: string) => {
        if (event === "tab:remove-by-id") return removeListenPromise;
        return Promise.resolve(vi.fn());
      });

      const { unmount } = render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await new Promise((r) => setTimeout(r, 30));

      // Unmount before the tab:remove-by-id promise resolves
      unmount();

      // Now resolve — the `if (cancelled) { fn(); }` branch fires
      resolveRemove(unlistenRemoveFn);
      await new Promise((r) => setTimeout(r, 50));

      expect(unlistenRemoveFn).toHaveBeenCalled();
    });
  });

  describe("WindowProvider — claim_tab_transfer returns null", () => {
    it("falls through to normal init when claim_tab_transfer returns null", async () => {
      vi.useFakeTimers();
      mockWindowLabel = "doc-nulltransfer";
      const { invoke } = await import("@tauri-apps/api/core");
      // URL has ?transfer but invoke returns null (no transfer data found)
      vi.mocked(invoke).mockResolvedValue(null);

      Object.defineProperty(globalThis, "location", {
        value: { search: "?transfer=true" },
        writable: true,
        configurable: true,
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await vi.advanceTimersByTimeAsync(200);

      // invoke was called for claim_tab_transfer (returned null)
      expect(invoke).toHaveBeenCalledWith("claim_tab_transfer", { windowLabel: "doc-nulltransfer" });
      // Should fall through to normal init and create a tab
      expect(mockCreateTab).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("WindowProvider — unhandled init error catch path", () => {
    it("handles unhandled rejection from init() via .catch()", async () => {
      vi.useFakeTimers();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Make getCurrentWebviewWindow throw on second call (after initial setup)
      // by making rehydrate throw async inside init()
      const { migrateWorkspaceStorage } = await import("../utils/workspaceStorage");
      let callCount = 0;
      vi.mocked(migrateWorkspaceStorage).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Simulate an async rejection that bubbles out of init()
          // by making it throw synchronously so init() throws
          throw new Error("async boom in init");
        }
      });

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await vi.advanceTimersByTimeAsync(200);

      expect(mockWindowContextError).toHaveBeenCalledWith(
        expect.stringContaining("Init failed"),
        expect.any(Error),
      );

      errorSpy.mockRestore();
      vi.mocked(migrateWorkspaceStorage).mockImplementation(() => {});
      vi.useRealTimers();
    });
  });

  describe("WindowProvider — cancelled tab:transfer listener path", () => {
    it("calls unlisten immediately when component unmounts before listener resolves", async () => {
      // Use a deferred promise so the listen promise resolves AFTER unmount
      let resolveTransfer!: (fn: () => void) => void;
      const transferListenPromise = new Promise<() => void>((resolve) => {
        resolveTransfer = resolve;
      });

      const unlistenFn = vi.fn();

      mockListen.mockImplementation((event: string) => {
        if (event === "tab:transfer") return transferListenPromise;
        return Promise.resolve(vi.fn());
      });

      const { unmount } = render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      // Wait for initial render
      await new Promise((r) => setTimeout(r, 50));

      // Unmount BEFORE the listen promise resolves (cancelled = true)
      unmount();

      // Now resolve the listen promise - the cancelled branch should call fn() immediately
      resolveTransfer(unlistenFn);

      await new Promise((r) => setTimeout(r, 50));

      // The unlisten function should have been called because cancelled was true
      expect(unlistenFn).toHaveBeenCalled();
    });
  });

  describe("WindowProvider — close_window failure via tab:remove-by-id", () => {
    it("calls windowCloseWarn when close_window invoke fails for doc window", async () => {
      mockWindowLabel = "doc-closefail";
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "close_window") return Promise.reject(new Error("cannot close"));
        return Promise.resolve(null);
      });
      // No remaining tabs after removal
      mockGetTabsByWindow.mockReturnValue([]);

      render(
        <WindowProvider>
          <div data-testid="child">content</div>
        </WindowProvider>,
      );

      await new Promise((r) => setTimeout(r, 100));

      // Find and invoke the tab:remove-by-id handler
      const removeCall = mockListen.mock.calls.find(
        (call: unknown[]) => call[0] === "tab:remove-by-id",
      );
      if (removeCall) {
        const removeHandler = removeCall![1];
        removeHandler({ payload: { tabId: "last-tab" } });

        await new Promise((r) => setTimeout(r, 100));

        const { windowCloseWarn } = await import("../utils/debug");
        expect(windowCloseWarn).toHaveBeenCalledWith(
          "Failed to close window:",
          expect.stringMatching(/cannot close|string/),
        );
      }

      vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
    });
  });
});
