// useRecentFilesSync — pushes the persisted recent-files list to the
// native macOS menu exactly once on mount (persist rehydration runs
// before Tauri is ready, so the store can't do this itself).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useRecentFilesSync } from "./useRecentFilesSync";

const syncSpy = vi.fn();
let originalSync: () => void;

beforeEach(() => {
  syncSpy.mockClear();
  originalSync = useRecentFilesStore.getState().syncToNativeMenu;
  useRecentFilesStore.setState({ syncToNativeMenu: syncSpy });
});

afterEach(() => {
  useRecentFilesStore.setState({ syncToNativeMenu: originalSync });
});

describe("useRecentFilesSync", () => {
  it("syncs the recent files to the native menu on mount", () => {
    renderHook(() => useRecentFilesSync());
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-sync on re-render", () => {
    const { rerender } = renderHook(() => useRecentFilesSync());
    rerender();
    rerender();
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});
