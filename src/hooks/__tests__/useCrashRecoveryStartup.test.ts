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

// Mock sonner toast
const mockToastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { info: (...args: unknown[]) => mockToastInfo(...args) },
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
});
