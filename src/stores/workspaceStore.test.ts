import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkspaceStore, DEFAULT_EXCLUDED_FOLDERS } from "./workspaceStore";

// Mock paths
vi.mock("@/utils/paths", () => ({
  isPathExcluded: vi.fn((path, _rootPath, excludeFolders) => {
    // Simple implementation: check if path contains any excluded folder
    return excludeFolders.some((folder: string) => path.includes(`/${folder}/`) || path.endsWith(`/${folder}`));
  }),
}));

// Mock workspaceStorage
vi.mock("@/utils/workspaceStorage", () => ({
  windowScopedStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

function resetWorkspaceStore() {
  useWorkspaceStore.setState({
    rootPath: null,
    config: null,
    isWorkspaceMode: false,
  });
}

beforeEach(() => {
  resetWorkspaceStore();
  vi.clearAllMocks();
});

describe("workspaceStore", () => {
  describe("initial state", () => {
    it("starts with null rootPath", () => {
      const state = useWorkspaceStore.getState();
      expect(state.rootPath).toBeNull();
    });

    it("starts with null config", () => {
      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("starts with isWorkspaceMode false", () => {
      const state = useWorkspaceStore.getState();
      expect(state.isWorkspaceMode).toBe(false);
    });
  });

  describe("openWorkspace", () => {
    it("sets rootPath and isWorkspaceMode", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path/to/project");

      const state = useWorkspaceStore.getState();
      expect(state.rootPath).toBe("/path/to/project");
      expect(state.isWorkspaceMode).toBe(true);
    });

    it("merges with default config when no config provided", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path/to/project");

      const state = useWorkspaceStore.getState();
      expect(state.config?.version).toBe(1);
      expect(state.config?.excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
      expect(state.config?.lastOpenTabs).toEqual([]);
      expect(state.config?.showHiddenFiles).toBe(false);
    });

    it("merges provided config with defaults", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path/to/project", {
        version: 1,
        excludeFolders: ["custom"],
        lastOpenTabs: ["/file.md"],
        showHiddenFiles: true,
      });

      const state = useWorkspaceStore.getState();
      expect(state.config?.excludeFolders).toEqual(["custom"]);
      expect(state.config?.lastOpenTabs).toEqual(["/file.md"]);
      expect(state.config?.showHiddenFiles).toBe(true);
    });
  });

  describe("closeWorkspace", () => {
    it("resets all workspace state", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path/to/project");
      store.closeWorkspace();

      const state = useWorkspaceStore.getState();
      expect(state.rootPath).toBeNull();
      expect(state.config).toBeNull();
      expect(state.isWorkspaceMode).toBe(false);
    });
  });

  describe("bootstrapConfig", () => {
    it("does nothing if no rootPath", () => {
      const store = useWorkspaceStore.getState();
      store.bootstrapConfig({ version: 1, excludeFolders: [], lastOpenTabs: [], showHiddenFiles: true });

      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("does nothing if not in workspace mode", () => {
      useWorkspaceStore.setState({
        rootPath: "/path",
        isWorkspaceMode: false,
        config: null,
      });

      const store = useWorkspaceStore.getState();
      store.bootstrapConfig({ version: 1, excludeFolders: [], lastOpenTabs: [], showHiddenFiles: true });

      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("sets config with defaults merged when in workspace mode", () => {
      useWorkspaceStore.setState({
        rootPath: "/path",
        isWorkspaceMode: true,
        config: null,
      });

      const store = useWorkspaceStore.getState();
      store.bootstrapConfig({ version: 1, excludeFolders: ["custom"], lastOpenTabs: [], showHiddenFiles: true });

      const state = useWorkspaceStore.getState();
      expect(state.config?.excludeFolders).toEqual(["custom"]);
    });

    it("uses defaults when null config provided", () => {
      useWorkspaceStore.setState({
        rootPath: "/path",
        isWorkspaceMode: true,
        config: null,
      });

      const store = useWorkspaceStore.getState();
      store.bootstrapConfig(null);

      const state = useWorkspaceStore.getState();
      expect(state.config?.excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
    });
  });

  describe("updateConfig", () => {
    it("does nothing if no config exists", () => {
      const store = useWorkspaceStore.getState();
      store.updateConfig({ showHiddenFiles: true });

      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("updates partial config", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.updateConfig({ showHiddenFiles: true });

      const state = useWorkspaceStore.getState();
      expect(state.config?.showHiddenFiles).toBe(true);
      expect(state.config?.excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
    });

    it("can update multiple fields", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.updateConfig({
        showHiddenFiles: true,
        lastOpenTabs: ["/file.md"],
      });

      const state = useWorkspaceStore.getState();
      expect(state.config?.showHiddenFiles).toBe(true);
      expect(state.config?.lastOpenTabs).toEqual(["/file.md"]);
    });
  });

  describe("addExcludedFolder", () => {
    it("does nothing if no config exists", () => {
      const store = useWorkspaceStore.getState();
      store.addExcludedFolder("new-folder");

      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("adds folder to exclusion list", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.addExcludedFolder("build");

      const state = useWorkspaceStore.getState();
      expect(state.config?.excludeFolders).toContain("build");
    });

    it("does not add duplicate folders", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.addExcludedFolder(".git");
      store.addExcludedFolder(".git");

      const state = useWorkspaceStore.getState();
      const gitCount = state.config?.excludeFolders.filter((f) => f === ".git").length;
      expect(gitCount).toBe(1);
    });
  });

  describe("removeExcludedFolder", () => {
    it("does nothing if no config exists", () => {
      const store = useWorkspaceStore.getState();
      store.removeExcludedFolder(".git");

      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("removes folder from exclusion list", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.removeExcludedFolder(".git");

      const state = useWorkspaceStore.getState();
      expect(state.config?.excludeFolders).not.toContain(".git");
    });

    it("does not affect other folders", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.removeExcludedFolder(".git");

      const state = useWorkspaceStore.getState();
      expect(state.config?.excludeFolders).toContain("node_modules");
      expect(state.config?.excludeFolders).toContain(".vmark");
    });
  });

  describe("setLastOpenTabs", () => {
    it("does nothing if no config exists", () => {
      const store = useWorkspaceStore.getState();
      store.setLastOpenTabs(["/file.md"]);

      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("sets last open tabs", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.setLastOpenTabs(["/file1.md", "/file2.md"]);

      const state = useWorkspaceStore.getState();
      expect(state.config?.lastOpenTabs).toEqual(["/file1.md", "/file2.md"]);
    });

    it("replaces existing tabs", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.setLastOpenTabs(["/old.md"]);
      store.setLastOpenTabs(["/new.md"]);

      const state = useWorkspaceStore.getState();
      expect(state.config?.lastOpenTabs).toEqual(["/new.md"]);
    });
  });

  describe("isPathExcluded", () => {
    it("returns false if no config or rootPath", () => {
      const store = useWorkspaceStore.getState();
      expect(store.isPathExcluded("/path/to/file")).toBe(false);
    });

    it("returns true for excluded folder paths", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/project");

      // Using mocked isPathExcluded
      expect(store.isPathExcluded("/project/.git/config")).toBe(true);
      expect(store.isPathExcluded("/project/node_modules/package")).toBe(true);
    });

    it("returns false for non-excluded paths", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/project");

      expect(store.isPathExcluded("/project/src/file.ts")).toBe(false);
    });
  });

  describe("DEFAULT_EXCLUDED_FOLDERS", () => {
    it("exports expected default folders", () => {
      expect(DEFAULT_EXCLUDED_FOLDERS).toContain(".git");
      expect(DEFAULT_EXCLUDED_FOLDERS).toContain("node_modules");
      expect(DEFAULT_EXCLUDED_FOLDERS).toContain(".vmark");
    });
  });
});
