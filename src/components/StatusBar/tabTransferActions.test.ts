import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { restoreTransferredTab, transferTabFromDragOut } from "./tabTransferActions";
import type { TabTransferPayload } from "@/types/tabTransfer";

// Mock sonner toast (imeToast forwards message to sonner.message when not composing)
vi.mock("sonner", () => ({
  toast: {
    message: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// i18n returns the key (or key|opts) so tests assert on stable identifiers
vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && Object.keys(opts).length) return `${key}|${JSON.stringify(opts)}`;
      return key;
    },
  },
}));

// Mock debug logger
vi.mock("@/utils/debug", () => ({
  windowCloseWarn: vi.fn(),
  tabContextError: vi.fn(),
}));

// Mock stores
const mockCreateTransferredTab = vi.fn(() => "restored-tab-id");
const mockInitDocument = vi.fn();
const mockGetTabsByWindow = vi.fn();
const mockDetachTab = vi.fn();
const mockRemoveDocument = vi.fn();
const mockGetDocument = vi.fn();

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      createTransferredTab: mockCreateTransferredTab,
      getTabsByWindow: mockGetTabsByWindow,
      detachTab: mockDetachTab,
    }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      initDocument: mockInitDocument,
      getDocument: mockGetDocument,
      removeDocument: mockRemoveDocument,
    }),
  },
}));

const mockGetWorkspaceState = vi.fn(() => ({ rootPath: "/workspace" as string | null }));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: (...args: unknown[]) => mockGetWorkspaceState(...args),
  },
}));

const mockInvoke = vi.mocked(invoke);

const baseTransferData: TabTransferPayload = {
  tabId: "tab-1",
  title: "Test Document",
  filePath: "/path/to/file.md",
  content: "# Hello",
  savedContent: "# Hello",
  isDirty: false,
  workspaceRoot: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default workspace mock after clearAllMocks resets it
  mockGetWorkspaceState.mockReturnValue({ rootPath: "/workspace" });
});

describe("restoreTransferredTab", () => {
  it("removes tab from target window via invoke", async () => {
    await restoreTransferredTab("main", "window-2", baseTransferData);
    expect(mockInvoke).toHaveBeenCalledWith("remove_tab_from_window", {
      targetWindowLabel: "window-2",
      tabId: "tab-1",
    });
  });

  it("creates transferred tab in source window", async () => {
    await restoreTransferredTab("main", "window-2", baseTransferData);
    expect(mockCreateTransferredTab).toHaveBeenCalledWith("main", {
      id: "tab-1",
      filePath: "/path/to/file.md",
      title: "Test Document",
      isPinned: false,
    });
  });

  it("initializes document with transfer data", async () => {
    await restoreTransferredTab("main", "window-2", baseTransferData);
    expect(mockInitDocument).toHaveBeenCalledWith(
      "restored-tab-id",
      "# Hello",
      "/path/to/file.md",
      "# Hello"
    );
  });

  it("handles null filePath", async () => {
    const data = { ...baseTransferData, filePath: null };
    await restoreTransferredTab("main", "window-2", data);
    expect(mockCreateTransferredTab).toHaveBeenCalledWith("main", {
      id: "tab-1",
      filePath: null,
      title: "Test Document",
      isPinned: false,
    });
    expect(mockInitDocument).toHaveBeenCalledWith(
      "restored-tab-id",
      "# Hello",
      null,
      "# Hello"
    );
  });
});

describe("transferTabFromDragOut", () => {
  const defaultOptions = {
    tabId: "tab-1",
    point: { screenX: 100, screenY: 200 },
    windowLabel: "main",
    triggerSnapback: vi.fn(),
    announce: vi.fn(),
  };

  function setupTabsAndDoc() {
    mockGetTabsByWindow.mockReturnValue([
      { id: "tab-1", title: "Doc 1", filePath: "/file1.md", isPinned: false },
      { id: "tab-2", title: "Doc 2", filePath: "/file2.md", isPinned: false },
    ]);
    mockGetDocument.mockReturnValue({
      content: "# Content",
      savedContent: "# Content",
      isDirty: false,
    });
  }

  it("does nothing if tab not found", async () => {
    mockGetTabsByWindow.mockReturnValue([]);
    await transferTabFromDragOut(defaultOptions);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(defaultOptions.triggerSnapback).not.toHaveBeenCalled();
  });

  it("blocks last tab in main window", async () => {
    mockGetTabsByWindow.mockReturnValue([
      { id: "tab-1", title: "Only Tab", filePath: null, isPinned: false },
    ]);
    await transferTabFromDragOut(defaultOptions);
    expect(defaultOptions.triggerSnapback).toHaveBeenCalledWith("tab-1");
    expect(defaultOptions.announce).toHaveBeenCalledWith(
      "dialog:toast.cannotMoveLastTab"
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("allows last tab from non-main window", async () => {
    mockGetTabsByWindow.mockReturnValue([
      { id: "tab-1", title: "Only Tab", filePath: null, isPinned: false },
    ]);
    mockGetDocument.mockReturnValue({
      content: "content",
      savedContent: "content",
      isDirty: false,
    });
    mockInvoke.mockResolvedValueOnce("window-2"); // find_drop_target_window
    mockInvoke.mockResolvedValueOnce(undefined); // transfer_tab_to_existing_window

    const opts = { ...defaultOptions, windowLabel: "secondary" };
    await transferTabFromDragOut(opts);
    // Should not trigger snapback — proceeds with transfer
    expect(opts.triggerSnapback).not.toHaveBeenCalled();
  });

  it("does nothing if document not found", async () => {
    mockGetTabsByWindow.mockReturnValue([
      { id: "tab-1", title: "Doc 1", filePath: null, isPinned: false },
      { id: "tab-2", title: "Doc 2", filePath: null, isPinned: false },
    ]);
    mockGetDocument.mockReturnValue(null);
    await transferTabFromDragOut(defaultOptions);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("transfers to existing window when drop target found", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce("window-2"); // find_drop_target_window
    mockInvoke.mockResolvedValueOnce(undefined); // transfer_tab_to_existing_window

    await transferTabFromDragOut(defaultOptions);

    expect(mockInvoke).toHaveBeenCalledWith("find_drop_target_window", {
      sourceWindowLabel: "main",
      screenX: 100,
      screenY: 200,
    });
    expect(mockInvoke).toHaveBeenCalledWith("transfer_tab_to_existing_window", {
      targetWindowLabel: "window-2",
      data: expect.objectContaining({ tabId: "tab-1", title: "Doc 1" }),
    });
    expect(defaultOptions.announce).toHaveBeenCalledWith(
      `dialog:toast.tabMovedAnnounce|${JSON.stringify({ title: "Doc 1" })}`
    );
    expect(mockDetachTab).toHaveBeenCalledWith("main", "tab-1");
    expect(mockRemoveDocument).toHaveBeenCalledWith("tab-1");
  });

  it("detaches to new window when no drop target", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce(null); // find_drop_target_window returns null
    mockInvoke.mockResolvedValueOnce("new-window"); // detach_tab_to_new_window

    await transferTabFromDragOut(defaultOptions);

    expect(mockInvoke).toHaveBeenCalledWith("detach_tab_to_new_window", {
      data: expect.objectContaining({ tabId: "tab-1" }),
    });
    expect(defaultOptions.announce).toHaveBeenCalledWith(
      `dialog:toast.tabDetachedAnnounce|${JSON.stringify({ title: "Doc 1" })}`
    );
    expect(mockDetachTab).toHaveBeenCalledWith("main", "tab-1");
    expect(mockRemoveDocument).toHaveBeenCalledWith("tab-1");
  });

  it("triggers snapback on invoke error", async () => {
    setupTabsAndDoc();
    mockInvoke.mockRejectedValueOnce(new Error("IPC failed"));

    await transferTabFromDragOut(defaultOptions);

    expect(defaultOptions.triggerSnapback).toHaveBeenCalledWith("tab-1");
    expect(defaultOptions.announce).toHaveBeenCalledWith(
      "dialog:toast.failedToMoveTabToNewWindow"
    );
    expect(mockDetachTab).not.toHaveBeenCalled();
  });

  it("includes workspace root in transfer data", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce(null);
    mockInvoke.mockResolvedValueOnce("new-win");

    await transferTabFromDragOut(defaultOptions);

    expect(mockInvoke).toHaveBeenCalledWith("detach_tab_to_new_window", {
      data: expect.objectContaining({ workspaceRoot: "/workspace" }),
    });
  });

  it("auto-closes non-main window when no remaining tabs", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce(null); // find_drop_target_window
    mockInvoke.mockResolvedValueOnce("new-win"); // detach_tab_to_new_window

    // After detach, no remaining tabs
    mockGetTabsByWindow
      .mockReturnValueOnce([
        { id: "tab-1", title: "Doc 1", filePath: "/f1.md", isPinned: false },
        { id: "tab-2", title: "Doc 2", filePath: "/f2.md", isPinned: false },
      ])
      .mockReturnValueOnce([]); // remaining = 0

    const opts = { ...defaultOptions, windowLabel: "secondary" };
    await transferTabFromDragOut(opts);

    // Should invoke close_window for the secondary window
    expect(mockInvoke).toHaveBeenCalledWith("close_window", expect.objectContaining({ label: expect.any(String) }));
  });

  it("does NOT auto-close main window even when no remaining tabs", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce("window-2"); // find_drop_target_window
    mockInvoke.mockResolvedValueOnce(undefined); // transfer_tab_to_existing_window

    // After detach, no remaining tabs but window is main
    mockGetTabsByWindow
      .mockReturnValueOnce([
        { id: "tab-1", title: "Doc 1", filePath: "/f1.md", isPinned: false },
        { id: "tab-2", title: "Doc 2", filePath: "/f2.md", isPinned: false },
      ])
      .mockReturnValueOnce([]); // remaining = 0

    await transferTabFromDragOut(defaultOptions); // windowLabel = "main"

    // Should NOT call close_window
    const closeWindowCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === "close_window"
    );
    expect(closeWindowCalls).toHaveLength(0);
  });

  it("undo callback on cross-window move calls restoreTransferredTab", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce("window-2"); // find_drop_target_window
    mockInvoke.mockResolvedValueOnce(undefined); // transfer_tab_to_existing_window

    await transferTabFromDragOut(defaultOptions);

    // Get the toast.message call and extract the onClick callback
    const { toast } = await import("sonner");
    const toastCall = vi.mocked(toast.message).mock.calls[0];
    const action = (toastCall[1] as Record<string, unknown>).action as { onClick: () => void };

    // Reset invoke to track restore calls
    mockInvoke.mockResolvedValue(undefined);
    action.onClick();

    // Should invoke remove_tab_from_window
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_tab_from_window", expect.objectContaining({ targetWindowLabel: "window-2" }));
    });
  });

  it("undo callback on detach calls restoreTransferredTab", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce(null); // no drop target
    mockInvoke.mockResolvedValueOnce("new-win"); // detach

    await transferTabFromDragOut(defaultOptions);

    const { toast } = await import("sonner");
    const toastCall = vi.mocked(toast.message).mock.calls[0];
    const action = (toastCall[1] as Record<string, unknown>).action as { onClick: () => void };

    mockInvoke.mockResolvedValue(undefined);
    action.onClick();

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_tab_from_window", expect.objectContaining({ targetWindowLabel: "new-win" }));
    });
  });

  it("undo callback for cross-window move logs error when restoreTransferredTab fails", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce("window-2"); // find_drop_target_window
    mockInvoke.mockResolvedValueOnce(undefined); // transfer_tab_to_existing_window

    await transferTabFromDragOut(defaultOptions);

    const { toast } = await import("sonner");
    const toastCall = vi.mocked(toast.message).mock.calls[0];
    const action = (toastCall[1] as Record<string, unknown>).action as { onClick: () => void };

    // Make restoreTransferredTab's invoke reject
    const { tabContextError } = await import("@/utils/debug");
    mockInvoke.mockRejectedValue(new Error("restore failed"));
    action.onClick();

    await vi.waitFor(() => {
      expect(tabContextError).toHaveBeenCalledWith(
        "Undo cross-window move failed:",
        expect.any(Error),
      );
    });
  });

  it("undo callback for detach logs error when restoreTransferredTab fails", async () => {
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce(null); // no drop target
    mockInvoke.mockResolvedValueOnce("new-win"); // detach

    await transferTabFromDragOut(defaultOptions);

    const { toast } = await import("sonner");
    const toastCall = vi.mocked(toast.message).mock.calls[0];
    const action = (toastCall[1] as Record<string, unknown>).action as { onClick: () => void };

    const { tabContextError } = await import("@/utils/debug");
    mockInvoke.mockRejectedValue(new Error("detach undo failed"));
    action.onClick();

    await vi.waitFor(() => {
      expect(tabContextError).toHaveBeenCalledWith(
        "Undo detach failed:",
        expect.any(Error),
      );
    });
  });

  it("close_window catch logs error via windowCloseWarn", async () => {
    setupTabsAndDoc();

    // After detach, no remaining tabs in non-main window
    mockGetTabsByWindow
      .mockReturnValueOnce([
        { id: "tab-1", title: "Doc 1", filePath: "/f1.md", isPinned: false },
        { id: "tab-2", title: "Doc 2", filePath: "/f2.md", isPinned: false },
      ])
      .mockReturnValueOnce([]);

    mockInvoke
      .mockResolvedValueOnce(null)  // find_drop_target_window
      .mockResolvedValueOnce("new-win")  // detach_tab_to_new_window
      .mockRejectedValueOnce(new Error("close failed"));  // close_window

    const { windowCloseWarn } = await import("@/utils/debug");

    const opts = { ...defaultOptions, windowLabel: "secondary" };
    await transferTabFromDragOut(opts);

    // close_window is called with .catch, so we need a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(windowCloseWarn)).toHaveBeenCalledWith(
      "Failed to close window:",
      "close failed",
    );
  });

  it("uses null workspaceRoot when rootPath is null (line 93 ?? null branch)", async () => {
    mockGetWorkspaceState.mockReturnValueOnce({ rootPath: null });
    setupTabsAndDoc();
    mockInvoke.mockResolvedValueOnce(null);
    mockInvoke.mockResolvedValueOnce("new-win");

    await transferTabFromDragOut(defaultOptions);

    expect(mockInvoke).toHaveBeenCalledWith("detach_tab_to_new_window", {
      data: expect.objectContaining({ workspaceRoot: null }),
    });
  });

  it("close_window non-Error rejection uses String() in windowCloseWarn", async () => {
    setupTabsAndDoc();

    mockGetTabsByWindow
      .mockReturnValueOnce([
        { id: "tab-1", title: "Doc 1", filePath: "/f1.md", isPinned: false },
        { id: "tab-2", title: "Doc 2", filePath: "/f2.md", isPinned: false },
      ])
      .mockReturnValueOnce([]);

    mockInvoke
      .mockResolvedValueOnce(null)          // find_drop_target_window
      .mockResolvedValueOnce("new-win")     // detach_tab_to_new_window
      .mockRejectedValueOnce("string-error"); // close_window rejects with a string

    const { windowCloseWarn } = await import("@/utils/debug");

    const opts = { ...defaultOptions, windowLabel: "secondary" };
    await transferTabFromDragOut(opts);

    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(windowCloseWarn)).toHaveBeenCalledWith(
      "Failed to close window:",
      "string-error",
    );
  });

  it("handles tab with null filePath", async () => {
    mockGetTabsByWindow.mockReturnValue([
      { id: "tab-1", title: "Untitled", filePath: undefined, isPinned: false },
      { id: "tab-2", title: "Doc 2", filePath: "/f.md", isPinned: false },
    ]);
    mockGetDocument.mockReturnValue({
      content: "hello",
      savedContent: "hello",
      isDirty: false,
    });
    mockInvoke.mockResolvedValueOnce(null);
    mockInvoke.mockResolvedValueOnce("new-win");

    await transferTabFromDragOut(defaultOptions);

    expect(mockInvoke).toHaveBeenCalledWith("detach_tab_to_new_window", {
      data: expect.objectContaining({ filePath: null }),
    });
  });
});
