import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCrashRecoveryWriter } from "../useCrashRecoveryWriter";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// Mock crashRecovery module
const mockWriteRecoverySnapshot = vi.fn();
vi.mock("@/utils/crashRecovery", () => ({
  writeRecoverySnapshot: (...args: unknown[]) => mockWriteRecoverySnapshot(...args),
}));

// Mock WindowContext
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

function makeDocState(overrides: Record<string, unknown> = {}) {
  return {
    content: "",
    savedContent: "",
    lastDiskContent: "",
    filePath: null,
    isDirty: false,
    isMissing: false,
    isDivergent: false,
    documentId: 1,
    cursorInfo: null,
    lastAutoSave: null,
    lineEnding: "lf" as const,
    hardBreakStyle: "backslash" as const,
    ...overrides,
  };
}

describe("useCrashRecoveryWriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWriteRecoverySnapshot.mockResolvedValue(true);

    // Setup tab store with test tabs
    useTabStore.setState({
      tabs: {
        main: [
          { id: "tab-1", filePath: null, title: "Untitled-1", isPinned: false },
          { id: "tab-2", filePath: "/path/doc.md", title: "doc.md", isPinned: false },
          { id: "tab-3", filePath: null, title: "Untitled-2", isPinned: false },
        ],
      },
      activeTabId: { main: "tab-1" },
    });

    // Setup document store — tab-1 and tab-2 dirty, tab-3 clean
    useDocumentStore.setState({
      documents: {
        "tab-1": makeDocState({
          content: "# Dirty untitled",
          isDirty: true,
        }),
        "tab-2": makeDocState({
          content: "# Modified saved doc",
          savedContent: "# Original",
          lastDiskContent: "# Original",
          filePath: "/path/doc.md",
          isDirty: true,
          documentId: 2,
        }),
        "tab-3": makeDocState({ documentId: 3 }),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes snapshots for dirty tabs after interval", async () => {
    renderHook(() => useCrashRecoveryWriter());

    await vi.advanceTimersByTimeAsync(10_000);

    // Should have written snapshots for tab-1 and tab-2 (dirty), not tab-3 (clean)
    expect(mockWriteRecoverySnapshot).toHaveBeenCalledTimes(2);

    expect(mockWriteRecoverySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "tab-1",
        content: "# Dirty untitled",
        filePath: null,
        title: "Untitled-1",
        windowLabel: "main",
      })
    );

    expect(mockWriteRecoverySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "tab-2",
        content: "# Modified saved doc",
        filePath: "/path/doc.md",
        title: "doc.md",
      })
    );
  });

  it("skips unchanged content on subsequent intervals", async () => {
    renderHook(() => useCrashRecoveryWriter());

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockWriteRecoverySnapshot).toHaveBeenCalledTimes(2);

    mockWriteRecoverySnapshot.mockClear();

    // Advance again — content hasn't changed
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockWriteRecoverySnapshot).toHaveBeenCalledTimes(0);
  });

  it("writes again when content changes", async () => {
    renderHook(() => useCrashRecoveryWriter());

    await vi.advanceTimersByTimeAsync(10_000);
    mockWriteRecoverySnapshot.mockClear();

    // Change content for tab-1
    useDocumentStore.setState({
      documents: {
        ...useDocumentStore.getState().documents,
        "tab-1": {
          ...useDocumentStore.getState().documents["tab-1"],
          content: "# Updated content",
        },
      },
    });

    await vi.advanceTimersByTimeAsync(10_000);

    // Only tab-1 should be re-written
    expect(mockWriteRecoverySnapshot).toHaveBeenCalledTimes(1);
    expect(mockWriteRecoverySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "tab-1",
        content: "# Updated content",
      })
    );
  });

  it("retries after failed write on next interval", async () => {
    // First interval: write fails, hash should NOT be cached
    mockWriteRecoverySnapshot.mockResolvedValue(false);
    renderHook(() => useCrashRecoveryWriter());

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockWriteRecoverySnapshot).toHaveBeenCalledTimes(2);

    mockWriteRecoverySnapshot.mockClear();

    // Second interval: write succeeds — should retry same content
    mockWriteRecoverySnapshot.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockWriteRecoverySnapshot).toHaveBeenCalledTimes(2);
  });

  it("does not throw on write errors", async () => {
    mockWriteRecoverySnapshot.mockRejectedValue(new Error("disk full"));
    renderHook(() => useCrashRecoveryWriter());

    await vi.advanceTimersByTimeAsync(10_000);

    // Should not throw — errors are caught internally
    expect(mockWriteRecoverySnapshot).toHaveBeenCalled();
  });

  it("cleans up interval on unmount", async () => {
    const { unmount } = renderHook(() => useCrashRecoveryWriter());
    unmount();

    mockWriteRecoverySnapshot.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockWriteRecoverySnapshot).not.toHaveBeenCalled();
  });
});
