import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCrashRecoveryStartup } from "../useCrashRecoveryStartup";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// Mock crashRecovery module
const mockReadRecoverySnapshots = vi.fn();
const mockDeleteStaleRecoveryFiles = vi.fn();
const mockDeleteRecoverySnapshot = vi.fn();
vi.mock("@/utils/crashRecovery", () => ({
  readRecoverySnapshots: () => mockReadRecoverySnapshots(),
  deleteStaleRecoveryFiles: (...args: unknown[]) => mockDeleteStaleRecoveryFiles(...args),
  deleteRecoverySnapshot: (...args: unknown[]) => mockDeleteRecoverySnapshot(...args),
}));

// Mock hot exit coordination
const mockWaitForRestoreComplete = vi.fn();
vi.mock("@/utils/hotExit/hotExitCoordination", () => ({
  waitForRestoreComplete: () => mockWaitForRestoreComplete(),
}));

// Mock sonner toast (imeToast forwards info to sonner.info, warning/error are passthrough)
const mockToastInfo = vi.fn();
const mockToastWarning = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: vi.fn(),
    warning: (...args: unknown[]) => mockToastWarning(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// i18n returns the key for assertable test output
vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && Object.keys(opts).length) return `${key}|${JSON.stringify(opts)}`;
      return key;
    },
  },
}));

// Mock WindowContext
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    tabId: "recovered-tab-1",
    windowLabel: "main",
    content: "# Recovered content",
    filePath: null,
    title: "Untitled-1",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("useCrashRecoveryStartup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWaitForRestoreComplete.mockResolvedValue(true);
    mockDeleteStaleRecoveryFiles.mockResolvedValue(undefined);
    mockDeleteRecoverySnapshot.mockResolvedValue(undefined);
    mockReadRecoverySnapshots.mockResolvedValue([]);

    // Reset stores
    useTabStore.setState({
      tabs: { main: [] },
      activeTabId: { main: null },
      untitledCounter: 0,
    });
    useDocumentStore.setState({ documents: {} });
  });

  it("waits for hot exit restore before proceeding", async () => {
    mockWaitForRestoreComplete.mockResolvedValue(true);
    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockWaitForRestoreComplete).toHaveBeenCalled();
    });
  });

  it("cleans stale files before reading snapshots", async () => {
    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockDeleteStaleRecoveryFiles).toHaveBeenCalledWith(7);
    });
  });

  it("restores untitled document from recovery snapshot", async () => {
    const snapshot = makeSnapshot({
      content: "# My recovered content",
      filePath: null,
      title: "Untitled-1",
    });
    mockReadRecoverySnapshots.mockResolvedValue([snapshot]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(
        expect.stringContaining("1")
      );
    });

    // Should have created a tab
    const tabs = useTabStore.getState().getTabsByWindow("main");
    expect(tabs.length).toBe(1);

    // Should have initialized document as dirty
    const doc = useDocumentStore.getState().getDocument(tabs[0].id);
    expect(doc).toBeDefined();
    expect(doc!.content).toBe("# My recovered content");
    expect(doc!.isDirty).toBe(true);
  });

  it("restores document with filePath from recovery snapshot", async () => {
    const snapshot = makeSnapshot({
      content: "# Modified file content",
      filePath: "/path/to/file.md",
      title: "file.md",
    });
    mockReadRecoverySnapshots.mockResolvedValue([snapshot]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalled();
    });

    const tabs = useTabStore.getState().getTabsByWindow("main");
    expect(tabs.length).toBe(1);
    expect(tabs[0].filePath).toBe("/path/to/file.md");

    const doc = useDocumentStore.getState().getDocument(tabs[0].id);
    expect(doc!.content).toBe("# Modified file content");
    expect(doc!.isDirty).toBe(true);
  });

  it("restores multiple documents and shows correct count", async () => {
    mockReadRecoverySnapshots.mockResolvedValue([
      makeSnapshot({ tabId: "t1", content: "Doc 1" }),
      makeSnapshot({ tabId: "t2", content: "Doc 2" }),
      makeSnapshot({ tabId: "t3", content: "Doc 3" }),
    ]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(
        expect.stringContaining("3")
      );
    });

    const tabs = useTabStore.getState().getTabsByWindow("main");
    expect(tabs.length).toBe(3);
  });

  it("deletes recovery files after successful restore", async () => {
    const snapshot = makeSnapshot();
    mockReadRecoverySnapshots.mockResolvedValue([snapshot]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith(
        snapshot.tabId
      );
    });
  });

  it("does nothing when no recovery snapshots exist", async () => {
    mockReadRecoverySnapshots.mockResolvedValue([]);
    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockReadRecoverySnapshots).toHaveBeenCalled();
    });

    expect(mockToastInfo).not.toHaveBeenCalled();
    expect(useTabStore.getState().getTabsByWindow("main")).toHaveLength(0);
  });

  it("deduplicates snapshots by filePath, keeping newest", async () => {
    const olderSnapshot = makeSnapshot({
      tabId: "t-old",
      filePath: "/path/same.md",
      content: "# Older version",
      timestamp: 1000,
    });
    const newerSnapshot = makeSnapshot({
      tabId: "t-new",
      filePath: "/path/same.md",
      content: "# Newer version",
      timestamp: 2000,
    });
    const untitledSnapshot = makeSnapshot({
      tabId: "t-untitled",
      filePath: null,
      content: "# Untitled doc",
      timestamp: 500,
    });

    mockReadRecoverySnapshots.mockResolvedValue([
      olderSnapshot,
      newerSnapshot,
      untitledSnapshot,
    ]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(
        expect.stringContaining("2")
      );
    });

    // Should restore 2 tabs: the newer filePath snapshot + the untitled one
    const tabs = useTabStore.getState().getTabsByWindow("main");
    expect(tabs.length).toBe(2);

    // The older duplicate should be deleted without restoring
    expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith("t-old");
    // The kept ones should also be deleted after restore
    expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith("t-new");
    expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith("t-untitled");
  });

  it("does not throw on errors during restore", async () => {
    mockReadRecoverySnapshots.mockRejectedValue(new Error("read failed"));
    renderHook(() => useCrashRecoveryStartup());

    // Should not throw — just log the error
    await vi.waitFor(() => {
      expect(mockReadRecoverySnapshots).toHaveBeenCalled();
    });
  });

  it("continues recovery even when hot exit restore times out", async () => {
    mockWaitForRestoreComplete.mockResolvedValue(false);
    const snapshot = makeSnapshot({ content: "# After timeout" });
    mockReadRecoverySnapshots.mockResolvedValue([snapshot]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(
        expect.stringContaining("1")
      );
    });

    const tabs = useTabStore.getState().getTabsByWindow("main");
    expect(tabs.length).toBe(1);
  });

  it("continues restoring other snapshots when one fails — partial recovery shows warning (B3)", async () => {
    const snapshot1 = makeSnapshot({ tabId: "t1", content: "Doc 1" });
    const snapshot2 = makeSnapshot({ tabId: "t2", content: "Doc 2" });
    mockReadRecoverySnapshots.mockResolvedValue([snapshot1, snapshot2]);

    // Make createTab throw for first call only
    const origCreateTab = useTabStore.getState().createTab;
    let callCount = 0;
    vi.spyOn(useTabStore.getState(), "createTab").mockImplementation(
      (...args: Parameters<typeof origCreateTab>) => {
        callCount++;
        if (callCount === 1) throw new Error("createTab failed");
        return origCreateTab(...args);
      }
    );

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockDeleteRecoverySnapshot).toHaveBeenCalled();
    });

    // Should have restored at least the second snapshot
    const tabs = useTabStore.getState().getTabsByWindow("main");
    expect(tabs.length).toBe(1);
    // Partial recovery → warning toast with recovered/total/failed numbers,
    // pinnable so the user can read the breakdown carefully.
    await vi.waitFor(() => {
      expect(mockToastWarning).toHaveBeenCalled();
    });
    const [msg, opts] = mockToastWarning.mock.calls[0];
    expect(msg).toEqual(expect.stringContaining("dialog:toast.crashRecoveredPartial"));
    // The real imeToast wrapper resolves { pin: true } into a sonner
    // action+id before forwarding to the mocked sonner — so we see the
    // resolved shape here. (imeToast's own tests cover the transformation.)
    expect(opts).toEqual(expect.objectContaining({ action: expect.any(Object) }));
    expect(mockToastInfo).not.toHaveBeenCalled();
  });

  it("only runs once even if re-rendered", async () => {
    mockReadRecoverySnapshots.mockResolvedValue([]);

    const { rerender } = renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockReadRecoverySnapshots).toHaveBeenCalledTimes(1);
    });

    rerender();

    // Should still only have been called once due to hasRun ref guard
    expect(mockReadRecoverySnapshots).toHaveBeenCalledTimes(1);
  });

  it("when ALL snapshots fail to restore, shows error toast (C5)", async () => {
    const snapshot = makeSnapshot({ tabId: "t-fail" });
    mockReadRecoverySnapshots.mockResolvedValue([snapshot]);

    // Make createTab throw a non-Error value (string)
    const origCreateTab = useTabStore.getState().createTab;
    useTabStore.setState({
      createTab: () => {
        throw "string error";
      },
    } as never);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    // Pinnable error so the user can read why nothing was recovered.
    const [msg, opts] = mockToastError.mock.calls[0];
    expect(msg).toEqual(expect.stringContaining("dialog:toast.crashRecoveryFailed"));
    // The real imeToast wrapper resolves { pin: true } into a sonner
    // action+id before forwarding to the mocked sonner — so we see the
    // resolved shape here. (imeToast's own tests cover the transformation.)
    expect(opts).toEqual(expect.objectContaining({ action: expect.any(Object) }));
    // No success info toast when 0 recovered
    expect(mockToastInfo).not.toHaveBeenCalled();

    // Restore original
    useTabStore.setState({ createTab: origCreateTab } as never);
  });

  it("handles outer catch with non-Error thrown value — surfaces error toast (C5)", async () => {
    mockWaitForRestoreComplete.mockRejectedValue("network down");
    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockWaitForRestoreComplete).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    const [msg, opts] = mockToastError.mock.calls[0];
    expect(msg).toEqual(expect.stringContaining("dialog:toast.crashRecoveryFailed"));
    // The real imeToast wrapper resolves { pin: true } into a sonner
    // action+id before forwarding to the mocked sonner — so we see the
    // resolved shape here. (imeToast's own tests cover the transformation.)
    expect(opts).toEqual(expect.objectContaining({ action: expect.any(Object) }));
    expect(mockToastInfo).not.toHaveBeenCalled();
  });

  it("deduplicates keeping newer when older snapshot appears first", async () => {
    const older = makeSnapshot({
      tabId: "t-older",
      filePath: "/dup.md",
      content: "old",
      timestamp: 100,
    });
    const newer = makeSnapshot({
      tabId: "t-newer",
      filePath: "/dup.md",
      content: "new",
      timestamp: 200,
    });
    // Order: older first, newer second
    mockReadRecoverySnapshots.mockResolvedValue([older, newer]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(expect.stringContaining("1"));
    });

    // The older duplicate should have been cleaned up
    expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith("t-older");
    expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith("t-newer");

    const tabs = useTabStore.getState().getTabsByWindow("main");
    expect(tabs.length).toBe(1);
    const doc = useDocumentStore.getState().getDocument(tabs[0].id);
    expect(doc!.content).toBe("new");
  });

  it("deduplicates keeping existing when newer snapshot appears first", async () => {
    const newer = makeSnapshot({
      tabId: "t-newer",
      filePath: "/dup.md",
      content: "new",
      timestamp: 200,
    });
    const older = makeSnapshot({
      tabId: "t-older",
      filePath: "/dup.md",
      content: "old",
      timestamp: 100,
    });
    // Order: newer first, older second — the map already has newer, older is skipped
    mockReadRecoverySnapshots.mockResolvedValue([newer, older]);

    renderHook(() => useCrashRecoveryStartup());

    await vi.waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(expect.stringContaining("1"));
    });

    const tabs = useTabStore.getState().getTabsByWindow("main");
    expect(tabs.length).toBe(1);
    const doc = useDocumentStore.getState().getDocument(tabs[0].id);
    expect(doc!.content).toBe("new");

    // Older duplicate cleaned up
    expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith("t-older");
  });
});
