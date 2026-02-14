/**
 * Tests for useWorkspaceSync hook
 *
 * Verifies that document windows pick up workspace config changes
 * made by the settings window via localStorage storage events.
 *
 * @module hooks/useWorkspaceSync.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { setCurrentWindowLabel } from "@/utils/workspaceStorage";

// Mock the workspace store's persist.rehydrate — must be before import
const mockRehydrate = vi.hoisted(() => vi.fn());
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    persist: {
      rehydrate: () => mockRehydrate(),
    },
  },
}));

// Import after mocks are set up
import { useWorkspaceSync } from "./useWorkspaceSync";

describe("useWorkspaceSync", () => {
  beforeEach(() => {
    mockRehydrate.mockClear();
    setCurrentWindowLabel("main");
  });

  afterEach(() => {
    setCurrentWindowLabel("main");
  });

  it("adds storage event listener on mount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const { unmount } = renderHook(() => useWorkspaceSync());

    expect(addSpy).toHaveBeenCalledWith("storage", expect.any(Function));

    unmount();
    addSpy.mockRestore();
  });

  it("removes storage event listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useWorkspaceSync());

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("storage", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("rehydrates store when matching workspace key changes", () => {
    renderHook(() => useWorkspaceSync());

    const event = new StorageEvent("storage", {
      key: "vmark-workspace:main",
      newValue: JSON.stringify({ state: { config: { showHiddenFiles: true } } }),
    });
    window.dispatchEvent(event);

    expect(mockRehydrate).toHaveBeenCalledTimes(1);
  });

  it("ignores storage events for other keys", () => {
    renderHook(() => useWorkspaceSync());

    const event = new StorageEvent("storage", {
      key: "vmark-settings",
      newValue: "{}",
    });
    window.dispatchEvent(event);

    expect(mockRehydrate).not.toHaveBeenCalled();
  });

  it("ignores storage events for other windows workspace keys", () => {
    renderHook(() => useWorkspaceSync());

    const event = new StorageEvent("storage", {
      key: "vmark-workspace:doc-1",
      newValue: "{}",
    });
    window.dispatchEvent(event);

    expect(mockRehydrate).not.toHaveBeenCalled();
  });

  it("uses current window label for key matching", () => {
    setCurrentWindowLabel("doc-2");
    renderHook(() => useWorkspaceSync());

    // Event for doc-2 should trigger rehydrate
    const event = new StorageEvent("storage", {
      key: "vmark-workspace:doc-2",
      newValue: "{}",
    });
    window.dispatchEvent(event);

    expect(mockRehydrate).toHaveBeenCalledTimes(1);
  });
});
