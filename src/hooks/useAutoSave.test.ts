/**
 * Tests for useAutoSave hook
 *
 * @module hooks/useAutoSave.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock dependencies before importing the hook
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: vi.fn(),
}));

vi.mock("@/utils/saveToPath", () => ({
  saveToPath: vi.fn(),
}));

vi.mock("@/utils/reentryGuard", () => ({
  isOperationInProgress: vi.fn(() => false),
}));

vi.mock("@/utils/wysiwygFlush", () => ({
  flushActiveWysiwygNow: vi.fn(),
}));

vi.mock("@/utils/debug", () => ({
  autoSaveLog: vi.fn(),
  saveError: vi.fn(),
}));

import { useAutoSave } from "./useAutoSave";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { saveToPath } from "@/utils/saveToPath";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: auto-save enabled with 1 second interval
    vi.mocked(useSettingsStore).mockImplementation((selector) => {
      const state = {
        general: {
          autoSaveEnabled: true,
          autoSaveInterval: 1, // 1 second for faster tests
        },
      };
      return selector(state as Parameters<typeof selector>[0]);
    });

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn().mockReturnValue({
        isDirty: true,
        filePath: "/tmp/doc.md",
        content: "Hello World",
        isMissing: false,
      }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(saveToPath).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves dirty documents at configured interval", async () => {
    renderHook(() => useAutoSave());

    // Advance past first interval
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).toHaveBeenCalledWith(
      "tab-1",
      "/tmp/doc.md",
      "Hello World",
      "auto"
    );
  });

  it("flushes WYSIWYG content before reading document state", async () => {
    const mockFlush = vi.mocked(flushActiveWysiwygNow);
    const getDocMock = vi.fn().mockReturnValue({
      isDirty: true,
      filePath: "/tmp/doc.md",
      content: "Hello World",
      isMissing: false,
    });
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: getDocMock,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // flush must be called before getDocument reads content
    expect(mockFlush).toHaveBeenCalledTimes(1);
    const flushOrder = mockFlush.mock.invocationCallOrder[0];
    const getDocOrder = getDocMock.mock.invocationCallOrder[0];
    expect(flushOrder).toBeLessThan(getDocOrder);
  });

  it("does not save when auto-save is disabled", async () => {
    vi.mocked(useSettingsStore).mockImplementation((selector) => {
      const state = {
        general: {
          autoSaveEnabled: false,
          autoSaveInterval: 1,
        },
      };
      return selector(state as Parameters<typeof selector>[0]);
    });

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("skips untitled documents (no filePath)", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn().mockReturnValue({
        isDirty: true,
        filePath: null, // untitled
        content: "Hello",
        isMissing: false,
      }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("skips clean documents (not dirty)", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn().mockReturnValue({
        isDirty: false,
        filePath: "/tmp/doc.md",
        content: "Hello",
        isMissing: false,
      }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("skips missing files", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn().mockReturnValue({
        isDirty: true,
        filePath: "/tmp/doc.md",
        content: "Hello",
        isMissing: true, // file was deleted
      }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("skips divergent documents (user chose 'keep my changes')", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn().mockReturnValue({
        isDirty: true,
        filePath: "/tmp/doc.md",
        content: "Hello",
        isMissing: false,
        isDivergent: true,
      }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("skips when no tabs exist", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("debounces rapid saves (5 second minimum gap)", async () => {
    renderHook(() => useAutoSave());

    // First save at 1 second
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(1);

    // Try again at 2 seconds - should be debounced
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(1);

    // Try again at 3 seconds - still debounced
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(1);

    // At 6 seconds (5+ seconds after first save) - should save again
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(2);
  });

  it("clears interval on unmount", async () => {
    const { unmount } = renderHook(() => useAutoSave());

    unmount();

    // Advance time and verify no save happens
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("uses saveType 'auto' for all saves", async () => {
    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "auto"
    );
  });

  it("skips when manual save is in progress", async () => {
    const { isOperationInProgress } = await import("@/utils/reentryGuard");
    vi.mocked(isOperationInProgress).mockReturnValue(true);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();

    vi.mocked(isOperationInProgress).mockReturnValue(false);
  });

  it("skips when document does not exist for a tab", async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn().mockReturnValue(null),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("handles save failure without crashing", async () => {
    vi.mocked(saveToPath).mockResolvedValue(false);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Save was called but returned false — should not crash
    expect(saveToPath).toHaveBeenCalled();
  });

  it("saves multiple dirty tabs in the same window", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    const getDocMock = vi.fn((tabId: string) => {
      if (tabId === "tab-1") {
        return { isDirty: true, filePath: "/tmp/doc1.md", content: "Content 1", isMissing: false };
      }
      if (tabId === "tab-2") {
        return { isDirty: true, filePath: "/tmp/doc2.md", content: "Content 2", isMissing: false };
      }
      return null;
    });

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: getDocMock,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(saveToPath).mockResolvedValue(true);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).toHaveBeenCalledTimes(2);
    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/doc1.md", "Content 1", "auto");
    expect(saveToPath).toHaveBeenCalledWith("tab-2", "/tmp/doc2.md", "Content 2", "auto");
  });

  it("prevents overlapping save cycles (reentry guard)", async () => {
    // Make saveToPath take a long time (longer than the interval)
    let resolveSave: (() => void) | null = null;
    vi.mocked(saveToPath).mockImplementation(
      () => new Promise<boolean>((resolve) => {
        resolveSave = () => resolve(true);
      })
    );

    renderHook(() => useAutoSave());

    // First interval fires — starts saving
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(1);

    // Second interval fires while first is still pending
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    // Should still be 1 — second call was blocked by reentry guard
    expect(saveToPath).toHaveBeenCalledTimes(1);

    // Complete the first save
    await act(async () => {
      resolveSave?.();
    });

    // Advance past debounce (5s) so next save can fire
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    // Now a new save should have started
    expect(saveToPath).toHaveBeenCalledTimes(2);
  });

  it("re-reads document state per tab (not stale snapshot)", async () => {
    let callCount = 0;
    const getDocMock = vi.fn(() => {
      callCount++;
      // Simulate content changing between calls (first tab save modifies state)
      return {
        isDirty: true,
        filePath: "/tmp/doc.md",
        content: `Content v${callCount}`,
        isMissing: false,
        isDivergent: false,
      };
    });

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: getDocMock,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // getDocument should be called once per tab (2 calls total)
    expect(getDocMock).toHaveBeenCalledTimes(2);
    // Each save should get fresh content
    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/doc.md", "Content v1", "auto");
    expect(saveToPath).toHaveBeenCalledWith("tab-2", "/tmp/doc.md", "Content v2", "auto");
  });

  it("continues saving remaining tabs when one tab throws", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    const getDocMock = vi.fn((tabId: string) => ({
      isDirty: true,
      filePath: tabId === "tab-1" ? "/tmp/bad.md" : "/tmp/good.md",
      content: "Content",
      isMissing: false,
      isDivergent: false,
    }));

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: getDocMock,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    // First tab throws, second succeeds
    vi.mocked(saveToPath)
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(true);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Both tabs should have been attempted
    expect(saveToPath).toHaveBeenCalledTimes(2);
    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/bad.md", "Content", "auto");
    expect(saveToPath).toHaveBeenCalledWith("tab-2", "/tmp/good.md", "Content", "auto");
  });

  it("falls back to MIN_INTERVAL_MS when autoSaveInterval is NaN", async () => {
    vi.mocked(useSettingsStore).mockImplementation((selector) => {
      const state = {
        general: {
          autoSaveEnabled: true,
          autoSaveInterval: NaN, // non-finite
        },
      };
      return selector(state as Parameters<typeof selector>[0]);
    });

    renderHook(() => useAutoSave());

    // Advance past the fallback interval (1000ms = MIN_INTERVAL_MS)
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).toHaveBeenCalled();
  });

  it("handles window with no tabs entry (undefined)", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {},
    } as unknown as ReturnType<typeof useTabStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).not.toHaveBeenCalled();
  });
});
