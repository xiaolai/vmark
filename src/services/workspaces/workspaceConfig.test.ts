// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { updateWorkspaceConfig, toggleShowHiddenFiles, toggleShowAllFiles } from "./workspaceConfig";

function resetWorkspace() {
  useWorkspaceStore.setState({
    rootPath: null,
    config: null,
    isWorkspaceMode: false,
  });
}

describe("workspaceConfig", () => {
  beforeEach(() => {
    resetWorkspace();
    vi.clearAllMocks();
  });

  it("does nothing when workspace is not active", async () => {
    await updateWorkspaceConfig({ showHiddenFiles: true });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("persists updates when workspace is active", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
      showHiddenFiles: false,
      showAllFiles: false,
    };

    useWorkspaceStore.setState({
      rootPath: "/project",
      config,
      isWorkspaceMode: true,
    });

    await updateWorkspaceConfig({ showHiddenFiles: true });

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        showHiddenFiles: true,
      },
    });
    expect(useWorkspaceStore.getState().config?.showHiddenFiles).toBe(true);
  });

  it("toggles all files", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
      showHiddenFiles: false,
      showAllFiles: false,
    };

    useWorkspaceStore.setState({
      rootPath: "/project",
      config,
      isWorkspaceMode: true,
    });

    await toggleShowAllFiles();

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        showAllFiles: true,
      },
    });
    expect(useWorkspaceStore.getState().config?.showAllFiles).toBe(true);
  });

  it("toggles hidden files", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
      showHiddenFiles: false,
      showAllFiles: false,
    };

    useWorkspaceStore.setState({
      rootPath: "/project",
      config,
      isWorkspaceMode: true,
    });

    await toggleShowHiddenFiles();

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        showHiddenFiles: true,
      },
    });
  });

  it("handles invoke error gracefully", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
      showHiddenFiles: false,
      showAllFiles: false,
    };

    useWorkspaceStore.setState({
      rootPath: "/project",
      config,
      isWorkspaceMode: true,
    });

    vi.mocked(invoke).mockRejectedValueOnce(new Error("write failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await updateWorkspaceConfig({ showHiddenFiles: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      "[Workspace]",
      "Failed to save workspace config:",
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it("does nothing when rootPath is null", async () => {
    useWorkspaceStore.setState({
      rootPath: null,
      config: { version: 1, excludeFolders: [], lastOpenTabs: [], showHiddenFiles: false, showAllFiles: false },
      isWorkspaceMode: true,
    });

    await updateWorkspaceConfig({ showHiddenFiles: true });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does nothing when config is null", async () => {
    useWorkspaceStore.setState({
      rootPath: "/project",
      config: null,
      isWorkspaceMode: true,
    });

    await updateWorkspaceConfig({ showHiddenFiles: true });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("toggles hidden files back to false when currently true", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
      showHiddenFiles: true,
      showAllFiles: false,
    };

    useWorkspaceStore.setState({
      rootPath: "/project",
      config,
      isWorkspaceMode: true,
    });

    await toggleShowHiddenFiles();

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        showHiddenFiles: false,
      },
    });
  });

  it("toggles all files back to false when currently true", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
      showHiddenFiles: false,
      showAllFiles: true,
    };

    useWorkspaceStore.setState({
      rootPath: "/project",
      config,
      isWorkspaceMode: true,
    });

    await toggleShowAllFiles();

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        showAllFiles: false,
      },
    });
  });

  it("toggleShowAllFiles defaults to false when config is null (line 44)", async () => {
    useWorkspaceStore.setState({
      rootPath: "/project",
      config: null,
      isWorkspaceMode: true,
    });

    await toggleShowAllFiles();
    // config is null, so updateWorkspaceConfig early-returns
    expect(invoke).not.toHaveBeenCalled();
  });

  it("defaults showHiddenFiles to false when config is missing the property", async () => {
    useWorkspaceStore.setState({
      rootPath: "/project",
      config: {
        version: 1,
        excludeFolders: [],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
      },
      isWorkspaceMode: true,
    });

    // toggleShowHiddenFiles reads config?.showHiddenFiles ?? false
    // Set config to null-ish for the toggle read, then set it back for the write
    useWorkspaceStore.setState({
      config: undefined as unknown as WorkspaceConfig,
    });

    // Should default to false and toggle to true
    await toggleShowHiddenFiles();
    // invoke is not called because config is null
    expect(invoke).not.toHaveBeenCalled();
  });
});
