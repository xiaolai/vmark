// @vitest-environment node
// WI-6R — ownership-scoped session persistence tests
// WI-10.3 — per-root split persistence (write side) tests
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { loadSplitLayout } from "@/services/persistence/splitLayoutPersistence";
import { persistWorkspaceSession } from "@/services/workspaces/workspaceSession";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";

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

// WI-6R — ownership-scoped persistence: with the rail on, EACH workspace
// instance's config receives only ITS OWN tabs (read-modify-write per root);
// loose tabs go to no workspace config; failures are isolated per root.
describe("persistWorkspaceSession — rail mode (WI-6R)", () => {
  const invokeMock = vi.mocked(invoke);

  function setRail(enabled: boolean): void {
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
    });
  }

  function addWorkspace(id: string, rootPath: string): void {
    const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
    if (!root.ok) throw new Error("bad test root");
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(
      createWorkspaceInstance({
        workspaceInstanceId: id,
        root: root.root,
        ownerWindowLabel: WINDOW_LABEL,
        createdFrom: "open",
      }),
    );
  }

  const DISK_A: WorkspaceConfig = {
    version: 1, excludeFolders: ["a-only"], lastOpenTabs: [], showHiddenFiles: false,
  } as WorkspaceConfig;
  const DISK_B: WorkspaceConfig = {
    version: 1, excludeFolders: ["b-only"], lastOpenTabs: [], showHiddenFiles: true,
  } as WorkspaceConfig;

  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(WINDOW_LABEL, "wsi-a");
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "read_workspace_config") {
        const { rootPath } = args as { rootPath: string };
        if (rootPath === "/repo-a") return DISK_A;
        if (rootPath === "/repo-b") return DISK_B;
        return null;
      }
      return undefined;
    });
  });

  function writesOf(): Array<{ rootPath: string; config: WorkspaceConfig }> {
    return invokeMock.mock.calls
      .filter(([cmd]) => cmd === "write_workspace_config")
      .map(([, args]) => args as { rootPath: string; config: WorkspaceConfig });
  }

  it("writes each root only its OWN tabs; loose paths in neither", async () => {
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-a/one.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-b/two.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/elsewhere/loose.md");
    useWorkspaceInstancesStore.getState().ensureLooseInstance(WINDOW_LABEL);

    await persistWorkspaceSession(WINDOW_LABEL);

    const writes = writesOf();
    expect(writes).toHaveLength(2);
    const a = writes.find((w) => w.rootPath === "/repo-a")!;
    const b = writes.find((w) => w.rootPath === "/repo-b")!;
    expect(a.config.lastOpenTabs).toEqual(["/repo-a/one.md"]);
    expect(b.config.lastOpenTabs).toEqual(["/repo-b/two.md"]);
    expect(JSON.stringify(writes)).not.toContain("/elsewhere/loose.md");
  });

  it("read-modify-write: each written config keeps its OWN root's disk fields", async () => {
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-a/one.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-b/two.md");

    await persistWorkspaceSession(WINDOW_LABEL);

    const writes = writesOf();
    expect(writes.find((w) => w.rootPath === "/repo-a")!.config.excludeFolders)
      .toEqual(["a-only"]);
    expect(writes.find((w) => w.rootPath === "/repo-b")!.config.excludeFolders)
      .toEqual(["b-only"]);
    expect(writes.find((w) => w.rootPath === "/repo-b")!.config.showHiddenFiles).toBe(true);
  });

  it("a write failure for one root does not prevent the others", async () => {
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-a/one.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-b/two.md");
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      const { rootPath } = (args ?? {}) as { rootPath?: string };
      if (cmd === "read_workspace_config") return rootPath === "/repo-a" ? DISK_A : DISK_B;
      if (cmd === "write_workspace_config" && rootPath === "/repo-a") {
        throw new Error("disk full");
      }
      return undefined;
    });

    await expect(persistWorkspaceSession(WINDOW_LABEL)).resolves.toBeUndefined();
    expect(writesOf().some((w) => w.rootPath === "/repo-b")).toBe(true);
  });

  it("does not depend on which instance is ACTIVE at close time", async () => {
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-a/one.md");
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-b/two.md");

    await persistWorkspaceSession(WINDOW_LABEL);
    const withAActive = JSON.stringify([...writesOf()].sort((x, y) => x.rootPath.localeCompare(y.rootPath)));

    vi.clearAllMocks();
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "read_workspace_config") {
        const { rootPath } = args as { rootPath: string };
        return rootPath === "/repo-a" ? DISK_A : DISK_B;
      }
      return undefined;
    });
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(WINDOW_LABEL, "wsi-b");

    await persistWorkspaceSession(WINDOW_LABEL);
    const withBActive = JSON.stringify([...writesOf()].sort((x, y) => x.rootPath.localeCompare(y.rootPath)));

    expect(withBActive).toBe(withAActive);
  });

  it("loose-only window (no workspace instances) → zero config writes", async () => {
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useWorkspaceInstancesStore.getState().ensureLooseInstance(WINDOW_LABEL);
    useTabStore.getState().createTab(WINDOW_LABEL, "/elsewhere/loose.md");

    await persistWorkspaceSession(WINDOW_LABEL);

    expect(writesOf()).toHaveLength(0);
  });

  it("a workspace with zero owned tabs writes EMPTY tab lists (not stale ones)", async () => {
    useTabStore.getState().createTab(WINDOW_LABEL, "/repo-a/one.md");
    // B has no tabs.
    await persistWorkspaceSession(WINDOW_LABEL);

    const b = writesOf().find((w) => w.rootPath === "/repo-b")!;
    expect(b.config.lastOpenTabs).toEqual([]);
  });

  it("two instances sharing one root: ONE write with the UNION of their tabs (R2-F10)", async () => {
    addWorkspace("wsi-a2", "/repo-a"); // duplicated root (corrupt-restore shape)
    const idOne = useTabStore.getState().createTab(WINDOW_LABEL, "/repo-a/one.md");
    const idTwo = useTabStore.getState().createTab(WINDOW_LABEL, "/repo-a/two.md");
    // Explicit claims put one tab in EACH same-root instance.
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs("wsi-a", [idOne], idOne);
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs("wsi-a2", [idTwo], idTwo);

    await persistWorkspaceSession(WINDOW_LABEL);

    const aWrites = writesOf().filter((w) => w.rootPath === "/repo-a");
    expect(aWrites).toHaveLength(1); // no double-write of one config file
    expect([...aWrites[0].config.lastOpenTabs].sort()).toEqual([
      "/repo-a/one.md",
      "/repo-a/two.md", // the second instance's tab is not lost
    ]);
  });

  // #1187 — this writer is the ONLY one that mints a config without going
  // through the store's normalizer, so it is the only place an
  // excludeFolders-less config could ever reach disk.
  describe("exclude-folder defaults for a root with no config on disk", () => {
    function diskReturns(value: WorkspaceConfig | null): void {
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "read_workspace_config") return value;
        return undefined;
      });
    }

    beforeEach(() => {
      useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
      addWorkspace("wsi-new", "/fresh-repo");
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance(WINDOW_LABEL, "wsi-new");
      useTabStore.getState().createTab(WINDOW_LABEL, "/fresh-repo/one.md");
    });

    it("mints the default excludes — never an empty list", async () => {
      diskReturns(null);

      await persistWorkspaceSession(WINDOW_LABEL);

      const write = writesOf().find((w) => w.rootPath === "/fresh-repo")!;
      expect(write.config.excludeFolders).toEqual([".git", "node_modules"]);
    });

    it("repairs a config a previous build auto-created with empty excludes", async () => {
      diskReturns({
        version: 1,
        excludeFolders: [],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
      } as WorkspaceConfig);

      await persistWorkspaceSession(WINDOW_LABEL);

      const write = writesOf().find((w) => w.rootPath === "/fresh-repo")!;
      expect(write.config.excludeFolders).toEqual([".git", "node_modules"]);
    });

    it("keeps an empty list the user cleared deliberately (identity present)", async () => {
      diskReturns({
        version: 1,
        excludeFolders: [],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
        identity: { id: "disk-id", createdAt: 1, trustLevel: "untrusted", trustedAt: null },
      } as WorkspaceConfig);

      await persistWorkspaceSession(WINDOW_LABEL);

      const write = writesOf().find((w) => w.rootPath === "/fresh-repo")!;
      expect(write.config.excludeFolders).toEqual([]);
    });

    it("leaves a configured exclude list alone", async () => {
      diskReturns({
        version: 1,
        excludeFolders: ["dist"],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
      } as WorkspaceConfig);

      await persistWorkspaceSession(WINDOW_LABEL);

      const write = writesOf().find((w) => w.rootPath === "/fresh-repo")!;
      expect(write.config.excludeFolders).toEqual(["dist"]);
    });
  });
});
