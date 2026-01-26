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

vi.mock("@/utils/debug", () => ({
  autoSaveLog: vi.fn(),
}));

import { useAutoSave } from "./useAutoSave";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { saveToPath } from "@/utils/saveToPath";

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
      activeTabId: { main: "tab-1" },
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

  it("skips when no active tab", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: null },
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
});
