import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";

const WINDOW_LABEL = "main";

function resetStores() {
  useWorkspaceStore.setState({
    rootPath: null,
    config: null,
    isWorkspaceMode: false,
  });
  useTabStore.getState().removeWindow(WINDOW_LABEL);
}

describe("persistWorkspaceSession", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  it("does nothing when not in workspace mode", async () => {
    await persistWorkspaceSession(WINDOW_LABEL);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("persists lastOpenTabs when workspace is active", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
    };

    useWorkspaceStore.setState({
      rootPath: "/project",
      config,
      isWorkspaceMode: true,
    });

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/project/a.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/project/b.md");
    // Update active tab for consistency
    useTabStore.getState().setActiveTab(WINDOW_LABEL, tabId);

    await persistWorkspaceSession(WINDOW_LABEL);

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        lastOpenTabs: ["/project/a.md", "/project/b.md"],
      },
    });
  });

  it("skips untitled tabs when persisting", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
    };

    useWorkspaceStore.setState({
      rootPath: "/project",
      config,
      isWorkspaceMode: true,
    });

    useTabStore.getState().createTab(WINDOW_LABEL, "/project/a.md");
    useTabStore.getState().createTab(WINDOW_LABEL, null);

    await persistWorkspaceSession(WINDOW_LABEL);

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        lastOpenTabs: ["/project/a.md"],
      },
    });
  });
});
