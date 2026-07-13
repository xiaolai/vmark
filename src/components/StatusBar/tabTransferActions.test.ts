import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { restoreTransferredTab, transferTabFromDragOut } from "./tabTransferActions";
import type { TabRemovalAck, TabTransferPayload } from "@/types/tabTransfer";

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
  useUnifiedHistoryStore: { getState: () => ({ documents: {}, clearDocument: vi.fn() }), subscribe: () => () => {} },
  useRevisionStore: { getState: () => ({ registerEdit: vi.fn(), clearRevision: vi.fn(), updateRevision: vi.fn(), setRevision: vi.fn(), getRevision: vi.fn(() => "rev-mock") }) },
  useLintStore: { getState: () => ({ clearDiagnostics: vi.fn() }), subscribe: () => () => {} },
  useLargeFileSessionStore: { getState: () => ({ clearForcedSource: vi.fn() }), subscribe: () => () => {} },
  useFileLoadStore: { getState: () => ({ active: false }) },
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

/** The state the destination window reports back on `prepare` — by definition
 *  newer than the snapshot the source captured when it handed the tab over. */
const liveInDestination: TabTransferPayload = {
  tabId: "tab-1",
  title: "Test Document",
  filePath: "/path/to/file.md",
  content: "# Hello\n\nEdited in the destination window",
  savedContent: "# Hello",
  isDirty: true,
  workspaceRoot: null,
};

function ackPrepare(data: TabTransferPayload | null, reason?: string): TabRemovalAck {
  return {
    requestId: "req-1",
    tabId: "tab-1",
    phase: "prepare",
    accepted: data !== null,
    reason,
    data: data ?? undefined,
  };
}

/** Route invoke() by command + phase so tests don't depend on call ordering. */
function mockRemovalProtocol(options: {
  prepare: TabRemovalAck | Error;
  commit?: TabRemovalAck | Error;
}) {
  mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd !== "remove_tab_from_window") return Promise.resolve(undefined);
    const outcome = args?.phase === "commit"
      ? options.commit ?? { ...ackPrepare(null), phase: "commit", accepted: true }
      : options.prepare;
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  });
}

describe("restoreTransferredTab", () => {
  it("asks the destination to prepare before anything is destroyed", async () => {
    mockRemovalProtocol({ prepare: ackPrepare(liveInDestination) });
    await restoreTransferredTab("main", "window-2", baseTransferData);
    expect(mockInvoke).toHaveBeenCalledWith("remove_tab_from_window", {
      targetWindowLabel: "window-2",
      tabId: "tab-1",
      phase: "prepare",
    });
  });

  it("restores the destination's CURRENT content, NOT the stale snapshot", async () => {
    // DATA-LOSS REGRESSION: the user edited the doc in the destination window
    // after the move. Undo must bring those edits back — restoring the
    // pre-transfer snapshot silently destroys them.
    mockRemovalProtocol({ prepare: ackPrepare(liveInDestination) });

    await restoreTransferredTab("main", "window-2", baseTransferData);

    expect(mockInitDocument).toHaveBeenCalledWith(
      "restored-tab-id",
      "# Hello\n\nEdited in the destination window",
      "/path/to/file.md",
      "# Hello",
    );
    // The snapshot's content must never reach the restored document.
    expect(mockInitDocument).not.toHaveBeenCalledWith(
      expect.anything(),
      "# Hello",
      expect.anything(),
      expect.anything(),
    );
  });

  it("restores the tab BEFORE the destination drops its copy", async () => {
    // Ordering is the safety property: if the commit leg fails we want a
    // duplicate tab (recoverable), never a hole (unrecoverable).
    const order: string[] = [];
    mockCreateTransferredTab.mockImplementationOnce(() => {
      order.push("restore");
      return "restored-tab-id";
    });
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "remove_tab_from_window") order.push(String(args?.phase));
      return Promise.resolve(
        args?.phase === "prepare" ? ackPrepare(liveInDestination) : undefined,
      );
    });

    await restoreTransferredTab("main", "window-2", baseTransferData);

    expect(order).toEqual(["prepare", "restore", "commit"]);
  });

  it("commits the removal in the destination once the tab is safe", async () => {
    mockRemovalProtocol({ prepare: ackPrepare(liveInDestination) });
    await restoreTransferredTab("main", "window-2", baseTransferData);
    expect(mockInvoke).toHaveBeenCalledWith("remove_tab_from_window", {
      targetWindowLabel: "window-2",
      tabId: "tab-1",
      phase: "commit",
    });
  });

  it("fails safely and destroys nothing when the destination refuses", async () => {
    mockRemovalProtocol({ prepare: ackPrepare(null, "tabNotFound") });

    await expect(
      restoreTransferredTab("main", "window-2", baseTransferData),
    ).rejects.toThrow(/refused|tabNotFound/i);

    expect(mockCreateTransferredTab).not.toHaveBeenCalled();
    expect(mockInitDocument).not.toHaveBeenCalled();
    // Crucially: no commit — the destination keeps its tab.
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "remove_tab_from_window",
      expect.objectContaining({ phase: "commit" }),
    );
  });

  it("fails safely and destroys nothing when the destination cannot be reached", async () => {
    mockRemovalProtocol({ prepare: new Error("Timed out waiting for 'window-2'") });

    await expect(
      restoreTransferredTab("main", "window-2", baseTransferData),
    ).rejects.toThrow(/timed out/i);

    expect(mockCreateTransferredTab).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "remove_tab_from_window",
      expect.objectContaining({ phase: "commit" }),
    );
  });

  it("keeps the restored tab when the commit leg fails (duplicate beats data loss)", async () => {
    mockRemovalProtocol({
      prepare: ackPrepare(liveInDestination),
      commit: new Error("target window vanished"),
    });

    await expect(
      restoreTransferredTab("main", "window-2", baseTransferData),
    ).resolves.toBeUndefined();

    expect(mockInitDocument).toHaveBeenCalledWith(
      "restored-tab-id",
      "# Hello\n\nEdited in the destination window",
      "/path/to/file.md",
      "# Hello",
    );
    const { tabContextError } = await import("@/utils/debug");
    expect(tabContextError).toHaveBeenCalledWith(
      expect.stringContaining("could not be removed"),
      expect.any(Error),
    );
  });

  it("restores the destination's current title and path (renamed / saved-as there)", async () => {
    mockRemovalProtocol({
      prepare: ackPrepare({
        ...liveInDestination,
        title: "renamed.md",
        filePath: "/path/to/renamed.md",
      }),
    });

    await restoreTransferredTab("main", "window-2", baseTransferData);

    expect(mockCreateTransferredTab).toHaveBeenCalledWith("main", {
      id: "tab-1",
      filePath: "/path/to/renamed.md",
      title: "renamed.md",
      isPinned: false,
    });
  });

  it("handles a destination tab with no file path", async () => {
    mockRemovalProtocol({
      prepare: ackPrepare({ ...liveInDestination, filePath: null }),
    });

    await restoreTransferredTab("main", "window-2", baseTransferData);

    expect(mockCreateTransferredTab).toHaveBeenCalledWith("main", {
      id: "tab-1",
      filePath: null,
      title: "Test Document",
      isPinned: false,
    });
    expect(mockInitDocument).toHaveBeenCalledWith(
      "restored-tab-id",
      "# Hello\n\nEdited in the destination window",
      null,
      "# Hello",
    );
  });

  it("rejects an accepted prepare that carries no data (malformed ack)", async () => {
    mockRemovalProtocol({
      prepare: { ...ackPrepare(null), accepted: true, data: undefined },
    });

    await expect(
      restoreTransferredTab("main", "window-2", baseTransferData),
    ).rejects.toThrow();
    expect(mockCreateTransferredTab).not.toHaveBeenCalled();
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
      { kind: "document", id: "tab-1", title: "Doc 1", filePath: "/file1.md", isPinned: false },
      { kind: "document", id: "tab-2", title: "Doc 2", filePath: "/file2.md", isPinned: false },
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
      { kind: "document", id: "tab-1", title: "Only Tab", filePath: null, isPinned: false },
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
      { kind: "document", id: "tab-1", title: "Only Tab", filePath: null, isPinned: false },
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

  it("snaps back and announces when the document is missing", async () => {
    mockGetTabsByWindow.mockReturnValue([
      { kind: "document", id: "tab-1", title: "Doc 1", filePath: null, isPinned: false },
      { kind: "document", id: "tab-2", title: "Doc 2", filePath: null, isPinned: false },
    ]);
    mockGetDocument.mockReturnValue(null);
    await transferTabFromDragOut(defaultOptions);
    expect(mockInvoke).not.toHaveBeenCalled();
    // A dropped tab that silently returns to nowhere reads as a broken drag.
    expect(defaultOptions.triggerSnapback).toHaveBeenCalledWith("tab-1");
    expect(defaultOptions.announce).toHaveBeenCalledWith("dialog:toast.cannotMoveTabNoDoc");
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
        { kind: "document", id: "tab-1", title: "Doc 1", filePath: "/f1.md", isPinned: false },
        { kind: "document", id: "tab-2", title: "Doc 2", filePath: "/f2.md", isPinned: false },
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
        { kind: "document", id: "tab-1", title: "Doc 1", filePath: "/f1.md", isPinned: false },
        { kind: "document", id: "tab-2", title: "Doc 2", filePath: "/f2.md", isPinned: false },
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

    // Reset invoke to drive the removal handshake
    mockRemovalProtocol({ prepare: ackPrepare(liveInDestination) });
    action.onClick();

    // Undo must round-trip through the destination and restore ITS content
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_tab_from_window", expect.objectContaining({ targetWindowLabel: "window-2", phase: "prepare" }));
      expect(mockInitDocument).toHaveBeenCalledWith(
        "restored-tab-id",
        "# Hello\n\nEdited in the destination window",
        "/path/to/file.md",
        "# Hello",
      );
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

    mockRemovalProtocol({ prepare: ackPrepare(liveInDestination) });
    action.onClick();

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_tab_from_window", expect.objectContaining({ targetWindowLabel: "new-win", phase: "prepare" }));
      expect(mockCreateTransferredTab).toHaveBeenCalled();
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
        { kind: "document", id: "tab-1", title: "Doc 1", filePath: "/f1.md", isPinned: false },
        { kind: "document", id: "tab-2", title: "Doc 2", filePath: "/f2.md", isPinned: false },
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
        { kind: "document", id: "tab-1", title: "Doc 1", filePath: "/f1.md", isPinned: false },
        { kind: "document", id: "tab-2", title: "Doc 2", filePath: "/f2.md", isPinned: false },
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
      { kind: "document", id: "tab-1", title: "Untitled", filePath: undefined, isPinned: false },
      { kind: "document", id: "tab-2", title: "Doc 2", filePath: "/f.md", isPinned: false },
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
