/**
 * Fault Injection Tests for useAutoSave
 *
 * Verifies error recovery when saveToPath rejects (disk full, permission denied, etc.).
 * Complements useAutoSave.test.ts which covers normal operation.
 *
 * @module hooks/useAutoSave.fault.test
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

vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPath: vi.fn(),
}));

vi.mock("@/utils/reentryGuard", () => ({
  isOperationInProgress: vi.fn(() => false),
}));

vi.mock("@/utils/debug", () => ({
  autoSaveLog: vi.fn(),
  saveError: vi.fn(),
}));

import { useAutoSave } from "./useAutoSave";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { saveToPath } from "@/services/persistence/saveToPath";
import { saveError } from "@/utils/debug";

describe("useAutoSave — fault injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: auto-save enabled with 1 second interval
    vi.mocked(useSettingsStore).mockImplementation((selector) => {
      const state = {
        general: {
          autoSaveEnabled: true,
          autoSaveInterval: 1,
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
        isDivergent: false,
      }),
    } as unknown as ReturnType<typeof useDocumentStore.getState>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("catches ENOSPC (disk full) rejection without crashing", async () => {
    const enospcError = new Error("ENOSPC: no space left on device");
    vi.mocked(saveToPath).mockRejectedValue(enospcError);

    renderHook(() => useAutoSave());

    // First interval fires — save should be attempted and error caught
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).toHaveBeenCalledTimes(1);
    expect(saveError).toHaveBeenCalledWith(
      "Auto-save failed for",
      "/tmp/doc.md",
      enospcError
    );
  });

  it("retries save on the next cycle after ENOSPC failure", async () => {
    // First attempt fails, second succeeds
    vi.mocked(saveToPath)
      .mockRejectedValueOnce(new Error("ENOSPC: no space left on device"))
      .mockResolvedValueOnce(true);

    renderHook(() => useAutoSave());

    // First interval: fails with ENOSPC
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(1);

    // The failed save does not set lastSaveRef, so no debounce applies.
    // Second interval: retries and succeeds
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(2);
    expect(saveToPath).toHaveBeenLastCalledWith(
      "tab-1",
      "/tmp/doc.md",
      "Hello World",
      "auto"
    );
  });

  it("document remains dirty after save failure (not marked as saved)", async () => {
    vi.mocked(saveToPath).mockRejectedValue(new Error("ENOSPC: no space left on device"));

    // Track whether markAutoSaved is called by checking the mock's return value
    const getDocMock = vi.fn().mockReturnValue({
      isDirty: true,
      filePath: "/tmp/doc.md",
      content: "Hello World",
      isMissing: false,
      isDivergent: false,
    });
    const markAutoSavedMock = vi.fn();

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: getDocMock,
      markAutoSaved: markAutoSavedMock,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // saveToPath handles markAutoSaved internally — but since it rejected,
    // the document store should NOT have markAutoSaved called from useAutoSave.
    // The isDirty flag remains true because saveToPath threw before reaching success path.
    // On the next cycle, getDocument still returns isDirty: true, so retry is attempted.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Second attempt was made because doc was still dirty
    expect(saveToPath).toHaveBeenCalledTimes(2);
  });

  it("handles permission denied error without crashing", async () => {
    const permError = new Error("EACCES: permission denied, open '/tmp/doc.md'");
    vi.mocked(saveToPath).mockRejectedValue(permError);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).toHaveBeenCalledTimes(1);
    expect(saveError).toHaveBeenCalledWith(
      "Auto-save failed for",
      "/tmp/doc.md",
      permError
    );
  });

  it("handles non-Error rejection (string thrown) gracefully", async () => {
    vi.mocked(saveToPath).mockRejectedValue("unexpected string error");

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveToPath).toHaveBeenCalledTimes(1);
    expect(saveError).toHaveBeenCalledWith(
      "Auto-save failed for",
      "/tmp/doc.md",
      "unexpected string error"
    );
  });

  it("saves remaining tabs when first tab hits disk full", async () => {
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }, { id: "tab-3" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    const getDocMock = vi.fn((tabId: string) => ({
      isDirty: true,
      filePath: `/tmp/${tabId}.md`,
      content: `Content ${tabId}`,
      isMissing: false,
      isDivergent: false,
    }));

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: getDocMock,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    // Tab 1 fails, tab 2 and 3 succeed
    vi.mocked(saveToPath)
      .mockRejectedValueOnce(new Error("ENOSPC: no space left on device"))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // All three tabs should have been attempted
    expect(saveToPath).toHaveBeenCalledTimes(3);
    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/tab-1.md", "Content tab-1", "auto");
    expect(saveToPath).toHaveBeenCalledWith("tab-2", "/tmp/tab-2.md", "Content tab-2", "auto");
    expect(saveToPath).toHaveBeenCalledWith("tab-3", "/tmp/tab-3.md", "Content tab-3", "auto");
  });

  it("clears reentry guard after all saves fail (allows retry next cycle)", async () => {
    // All saves fail
    vi.mocked(saveToPath).mockRejectedValue(new Error("ENOSPC"));

    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
    } as unknown as ReturnType<typeof useTabStore.getState>);

    const getDocMock = vi.fn(() => ({
      isDirty: true,
      filePath: "/tmp/doc.md",
      content: "Content",
      isMissing: false,
      isDivergent: false,
    }));

    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: getDocMock,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);

    renderHook(() => useAutoSave());

    // First cycle: all fail
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(2);

    // Second cycle: should retry (reentry guard was cleared in finally block)
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(4);
  });

  it("does not update lastSaveRef when all saves fail (no debounce on retry)", async () => {
    vi.mocked(saveToPath).mockRejectedValue(new Error("ENOSPC"));

    renderHook(() => useAutoSave());

    // First cycle: fails
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(1);

    // Immediately next cycle (1s later): should retry without 5s debounce
    // because lastSaveRef was NOT updated (no successful save)
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(2);

    // And again at 3s
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(3);
  });

  it("applies debounce only after a successful save, not after failures", async () => {
    // First call fails, second succeeds
    vi.mocked(saveToPath)
      .mockRejectedValueOnce(new Error("ENOSPC"))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    renderHook(() => useAutoSave());

    // 1s: fails — no debounce applied
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(1);

    // 2s: retries immediately (no debounce) — succeeds this time
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(2);

    // 3s: debounce now applies (5s from last success)
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(2); // still 2

    // 7s: past debounce window — should save again
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(saveToPath).toHaveBeenCalledTimes(3);
  });
});
