import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { loadSplitLayout } from "@/services/persistence/splitLayoutPersistence";
import { persistWorkspaceSession } from "@/hooks/workspaceSession";

const WINDOW_LABEL = "main";

function resetStores() {
  useWorkspaceStore.setState({
    rootPath: null,
    config: null,
    isWorkspaceMode: false,
  });
  useTabStore.getState().removeWindow(WINDOW_LABEL);
  usePaneStore.setState({ byWindow: {} });
  localStorage.clear();
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
      showHiddenFiles: false,
      showAllFiles: false,
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
        sessionTabs: {
          version: 1,
          tabs: [
            { kind: "document", path: "/project/a.md" },
            { kind: "document", path: "/project/b.md" },
          ],
        },
      },
    });
  });

  it("skips untitled tabs when persisting", async () => {
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

    useTabStore.getState().createTab(WINDOW_LABEL, "/project/a.md");
    useTabStore.getState().createTab(WINDOW_LABEL, null);

    await persistWorkspaceSession(WINDOW_LABEL);

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        // Legacy field: only the saved path (untitled excluded).
        lastOpenTabs: ["/project/a.md"],
        // New field: full ordered list including the untitled tab.
        sessionTabs: {
          version: 1,
          tabs: [
            { kind: "document", path: "/project/a.md" },
            { kind: "document", path: null },
          ],
        },
      },
    });
  });

  it("persists a browser tab into sessionTabs but NOT into legacy lastOpenTabs", async () => {
    const config: WorkspaceConfig = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
      showHiddenFiles: false,
      showAllFiles: false,
    };
    useWorkspaceStore.setState({ rootPath: "/project", config, isWorkspaceMode: true });

    useTabStore.getState().createTab(WINDOW_LABEL, "/project/a.md");
    useTabStore.getState().createBrowserTab(WINDOW_LABEL, "https://example.com/", "Example");

    await persistWorkspaceSession(WINDOW_LABEL);

    expect(invoke).toHaveBeenCalledWith("write_workspace_config", {
      rootPath: "/project",
      config: {
        ...config,
        // Downgrade-safe: old binaries read this and restore only the document.
        lastOpenTabs: ["/project/a.md"],
        // New builds read this and get the browser tab back too.
        sessionTabs: {
          version: 1,
          tabs: [
            { kind: "document", path: "/project/a.md" },
            { kind: "browser", url: "https://example.com/", title: "Example" },
          ],
        },
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

    await persistWorkspaceSession(WINDOW_LABEL);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[Workspace]",
      "Failed to save workspace config:",
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it("does nothing when rootPath is null but workspace mode is true", async () => {
    useWorkspaceStore.setState({
      rootPath: null,
      config: { version: 1, excludeFolders: [], lastOpenTabs: [], showHiddenFiles: false, showAllFiles: false },
      isWorkspaceMode: true,
    });

    await persistWorkspaceSession(WINDOW_LABEL);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does nothing when config is null", async () => {
    useWorkspaceStore.setState({
      rootPath: "/project",
      config: null,
      isWorkspaceMode: true,
    });

    await persistWorkspaceSession(WINDOW_LABEL);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("saves both pane paths to localStorage when a split is open (#1081)", async () => {
    useWorkspaceStore.setState({
      rootPath: "/project",
      config: { version: 1, excludeFolders: [], lastOpenTabs: [], showHiddenFiles: false, showAllFiles: false },
      isWorkspaceMode: true,
    });
    const primary = useTabStore.getState().createTab(WINDOW_LABEL, "/project/a.md");
    const secondary = useTabStore.getState().createTab(WINDOW_LABEL, "/project/b.md");
    useTabStore.getState().setActiveTab(WINDOW_LABEL, primary);
    usePaneStore.getState().openSplit(WINDOW_LABEL, secondary);
    usePaneStore.getState().setOrientation(WINDOW_LABEL, "vertical");

    await persistWorkspaceSession(WINDOW_LABEL);

    expect(loadSplitLayout("/project")).toEqual({
      orientation: "vertical",
      fraction: 0.5,
      syncScroll: false,
      primaryPath: "/project/a.md",
      secondaryPath: "/project/b.md",
    });
  });

  it("clears any saved split layout when no split is open (#1081)", async () => {
    // Pre-seed a stale layout that must be cleared.
    localStorage.setItem(
      "vmark-split-layout:/project",
      JSON.stringify({ orientation: "horizontal", fraction: 0.5, syncScroll: false, primaryPath: "/x", secondaryPath: "/y" }),
    );
    useWorkspaceStore.setState({
      rootPath: "/project",
      config: { version: 1, excludeFolders: [], lastOpenTabs: [], showHiddenFiles: false, showAllFiles: false },
      isWorkspaceMode: true,
    });
    useTabStore.getState().createTab(WINDOW_LABEL, "/project/a.md");

    await persistWorkspaceSession(WINDOW_LABEL);

    expect(loadSplitLayout("/project")).toBeNull();
  });
});
