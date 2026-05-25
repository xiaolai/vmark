import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRecentWorkspacesSync } from "./useRecentWorkspacesSync";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

// Mock pathUtils
vi.mock("@/utils/pathUtils", () => ({
  getFileName: vi.fn((path: string) => path.split("/").pop() || path),
}));

describe("useRecentWorkspacesSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useRecentWorkspacesStore.setState({
      workspaces: [],
      maxWorkspaces: 10,
    });
  });

  it("calls syncToNativeMenu on mount", async () => {
    const syncSpy = vi.spyOn(useRecentWorkspacesStore.getState(), "syncToNativeMenu");

    renderHook(() => useRecentWorkspacesSync());

    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it("syncs existing workspaces to native menu", async () => {
    const { invoke } = await import("@tauri-apps/api/core");

    // Pre-populate store with workspaces
    useRecentWorkspacesStore.setState({
      workspaces: [
        { path: "/path/to/project1", name: "project1", timestamp: 1 },
        { path: "/path/to/project2", name: "project2", timestamp: 2 },
      ],
    });

    renderHook(() => useRecentWorkspacesSync());

    expect(invoke).toHaveBeenCalledWith("update_recent_workspaces", {
      workspaces: ["/path/to/project1", "/path/to/project2"],
    });
  });

  it("syncs empty list when no workspaces", async () => {
    const { invoke } = await import("@tauri-apps/api/core");

    renderHook(() => useRecentWorkspacesSync());

    expect(invoke).toHaveBeenCalledWith("update_recent_workspaces", {
      workspaces: [],
    });
  });

  it("only syncs once on mount, not on re-render", async () => {
    const { invoke } = await import("@tauri-apps/api/core");

    const { rerender } = renderHook(() => useRecentWorkspacesSync());

    expect(invoke).toHaveBeenCalledTimes(1);

    rerender();
    rerender();

    // Still only 1 call (from mount)
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
