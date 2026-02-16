import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCrashRecoveryCleanup } from "../useCrashRecoveryCleanup";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// Mock crashRecovery module
const mockDeleteRecoverySnapshot = vi.fn();
const mockDeleteRecoveryFilesForTabs = vi.fn();
vi.mock("@/utils/crashRecovery", () => ({
  deleteRecoverySnapshot: (...args: unknown[]) => mockDeleteRecoverySnapshot(...args),
  deleteRecoveryFilesForTabs: (...args: unknown[]) => mockDeleteRecoveryFilesForTabs(...args),
}));

// Mock WindowContext
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

describe("useCrashRecoveryCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteRecoverySnapshot.mockResolvedValue(undefined);
    mockDeleteRecoveryFilesForTabs.mockResolvedValue(undefined);

    // Setup initial state with two tabs
    useTabStore.setState({
      tabs: {
        main: [
          { id: "tab-1", filePath: null, title: "Untitled-1", isPinned: false },
          { id: "tab-2", filePath: "/path/doc.md", title: "doc.md", isPinned: false },
        ],
      },
      activeTabId: { main: "tab-1" },
    });

    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: "# Content",
          savedContent: "",
          lastDiskContent: "",
          filePath: null,
          isDirty: true,
          isMissing: false,
          isDivergent: false,
          documentId: 1,
          cursorInfo: null,
          lastAutoSave: null,
          lineEnding: "lf" as const,
          hardBreakStyle: "backslash" as const,
        },
        "tab-2": {
          content: "# Saved",
          savedContent: "# Saved",
          lastDiskContent: "# Saved",
          filePath: "/path/doc.md",
          isDirty: false,
          isMissing: false,
          isDivergent: false,
          documentId: 2,
          cursorInfo: null,
          lastAutoSave: null,
          lineEnding: "lf" as const,
          hardBreakStyle: "backslash" as const,
        },
      },
    });
  });

  it("deletes recovery file when tab is removed from store", async () => {
    renderHook(() => useCrashRecoveryCleanup());

    // Remove tab-1 from tabStore (simulating tab close)
    act(() => {
      useTabStore.setState({
        tabs: {
          main: [
            { id: "tab-2", filePath: "/path/doc.md", title: "doc.md", isPinned: false },
          ],
        },
      });
    });

    // Wait for async operation
    await vi.waitFor(() => {
      expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith("tab-1");
    });
  });

  it("deletes recovery file when document transitions from dirty to clean", async () => {
    renderHook(() => useCrashRecoveryCleanup());

    // tab-1 becomes clean (e.g., saved)
    act(() => {
      useDocumentStore.setState({
        documents: {
          ...useDocumentStore.getState().documents,
          "tab-1": {
            ...useDocumentStore.getState().documents["tab-1"],
            isDirty: false,
            savedContent: "# Content",
          },
        },
      });
    });

    await vi.waitFor(() => {
      expect(mockDeleteRecoverySnapshot).toHaveBeenCalledWith("tab-1");
    });
  });

  it("does not delete recovery file for already-clean documents", () => {
    renderHook(() => useCrashRecoveryCleanup());

    // tab-2 is already clean — changing unrelated field should not trigger deletion
    act(() => {
      useDocumentStore.setState({
        documents: {
          ...useDocumentStore.getState().documents,
          "tab-2": {
            ...useDocumentStore.getState().documents["tab-2"],
            content: "# Still saved",
            savedContent: "# Still saved",
          },
        },
      });
    });

    // Should not be called — tab-2 was already clean
    expect(mockDeleteRecoverySnapshot).not.toHaveBeenCalled();
  });

  it("deletes only this window's tab snapshots on beforeunload", () => {
    renderHook(() => useCrashRecoveryCleanup());

    // Simulate beforeunload
    window.dispatchEvent(new Event("beforeunload"));

    // Should call per-window cleanup, not global deleteAll
    expect(mockDeleteRecoveryFilesForTabs).toHaveBeenCalledWith(["tab-1", "tab-2"]);
  });

  it("cleans up subscriptions and listener on unmount", () => {
    const { unmount } = renderHook(() => useCrashRecoveryCleanup());
    unmount();

    // After unmount, store changes should not trigger deletion
    act(() => {
      useTabStore.setState({
        tabs: { main: [] },
      });
    });

    expect(mockDeleteRecoverySnapshot).not.toHaveBeenCalled();
  });
});
