/**
 * Tests for useFileOperations hook - Move to functionality
 *
 * @module hooks/useFileOperations.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri APIs
const mockInvoke = vi.fn(() => Promise.resolve());
const mockClose = vi.fn(() => Promise.resolve());
const mockCloseTab = vi.fn();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    close: mockClose,
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/utils/paths", () => ({
  isWithinRoot: vi.fn(),
  getParentDir: vi.fn((path: string) => {
    const lastSlash = path.lastIndexOf("/");
    return lastSlash > 0 ? path.substring(0, lastSlash) : "";
  }),
}));

import { moveTabToNewWorkspaceWindow } from "./useFileOperations";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { isWithinRoot } from "@/utils/paths";

describe("moveTabToNewWorkspaceWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default workspace setup
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: "/workspace",
    } as ReturnType<typeof useWorkspaceStore.getState>);

    // Default tab setup - multiple tabs
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);
  });

  it("does nothing when no workspace is set", async () => {
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      rootPath: null,
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/some/file.md");

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockCloseTab).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("does nothing when file is within workspace", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(true);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/workspace/file.md");

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockCloseTab).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("opens new workspace window when file is outside workspace", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/folder/file.md");

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/other/folder",
      filePath: "/other/folder/file.md",
    });
  });

  it("closes only the tab when multiple tabs exist", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }, { id: "tab-2" }] },
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-1");
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("closes entire window when it is the last tab", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [{ id: "tab-1" }] }, // Only one tab
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    expect(mockClose).toHaveBeenCalled();
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("handles empty tabs array as last tab", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: { main: [] }, // Edge case: empty array
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    // Length 0 < 1, so isLastTab is false (0 !== 1), but we treat empty as "close window"
    // Actually: 0 === 1 is false, so it will close tab, not window
    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-1");
  });

  it("handles missing window label in tabs", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);
    vi.mocked(useTabStore.getState).mockReturnValue({
      tabs: {}, // No "main" key
      closeTab: mockCloseTab,
    } as unknown as ReturnType<typeof useTabStore.getState>);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/other/file.md");

    // tabs["main"] is undefined, || [] makes it empty array, length 0 !== 1
    expect(mockCloseTab).toHaveBeenCalledWith("main", "tab-1");
  });

  it("derives workspace root from file parent directory", async () => {
    vi.mocked(isWithinRoot).mockReturnValue(false);

    await moveTabToNewWorkspaceWindow("main", "tab-1", "/deep/nested/folder/file.md");

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/deep/nested/folder",
      filePath: "/deep/nested/folder/file.md",
    });
  });

  it("uses isWithinRoot for path comparison (not string prefix)", async () => {
    // This tests that we use isWithinRoot which handles edge cases like
    // /workspace vs /workspace-other correctly
    vi.mocked(isWithinRoot).mockImplementation((root, target) => {
      // Simulate proper boundary checking
      const normalizedRoot = root.replace(/\/$/, "");
      const normalizedTarget = target.replace(/\/$/, "");
      return normalizedTarget === normalizedRoot ||
        normalizedTarget.startsWith(normalizedRoot + "/");
    });

    // /workspace-other should NOT be within /workspace
    await moveTabToNewWorkspaceWindow("main", "tab-1", "/workspace-other/file.md");

    expect(mockInvoke).toHaveBeenCalled();
  });
});
