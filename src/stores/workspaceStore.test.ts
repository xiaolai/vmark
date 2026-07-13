import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkspaceStore, DEFAULT_EXCLUDED_FOLDERS } from "./workspaceStore";

// Mock workspaceIdentity
vi.mock("@/utils/workspaceIdentity", () => ({
  createWorkspaceIdentity: vi.fn(() => ({
    id: "mock-uuid-1234",
    createdAt: 1700000000000,
    trustLevel: "untrusted",
    trustedAt: null,
  })),
  grantTrust: vi.fn((identity) => ({
    ...identity,
    trustLevel: "trusted",
    trustedAt: 1700000001000,
  })),
  revokeTrust: vi.fn((identity) => ({
    ...identity,
    trustLevel: "untrusted",
    trustedAt: null,
  })),
  isTrusted: vi.fn((identity) => identity?.trustLevel === "trusted"),
}));

// Mock paths
vi.mock("@/utils/paths", () => ({
  isPathExcluded: vi.fn((path, _rootPath, excludeFolders) => {
    // Simple implementation: check if path contains any excluded folder
    return excludeFolders.some((folder: string) => path.includes(`/${folder}/`) || path.endsWith(`/${folder}`));
  }),
}));

// Mock workspaceStorage
vi.mock("@/services/persistence/workspaceStorage", () => ({
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

    it("creates identity if not provided", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path/to/project");

      const state = useWorkspaceStore.getState();
      expect(state.config?.identity).toBeDefined();
      expect(state.config?.identity?.id).toBe("mock-uuid-1234");
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
        showAllFiles: false,
      });

      const state = useWorkspaceStore.getState();
      expect(state.config?.excludeFolders).toEqual(["custom"]);
      expect(state.config?.lastOpenTabs).toEqual(["/file.md"]);
      expect(state.config?.showHiddenFiles).toBe(true);
    });

    it("preserves existing identity when provided", () => {
      const existingIdentity = {
        id: "existing-id",
        createdAt: 1600000000000,
        trustLevel: "trusted" as const,
        trustedAt: 1600000001000,
      };

      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path/to/project", {
        version: 1,
        excludeFolders: [],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
        identity: existingIdentity,
      });

      const state = useWorkspaceStore.getState();
      expect(state.config?.identity?.id).toBe("existing-id");
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
      store.bootstrapConfig({ version: 1, excludeFolders: [], lastOpenTabs: [], showHiddenFiles: true, showAllFiles: false });

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
      store.bootstrapConfig({ version: 1, excludeFolders: [], lastOpenTabs: [], showHiddenFiles: true, showAllFiles: false });

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
      store.bootstrapConfig({ version: 1, excludeFolders: ["custom"], lastOpenTabs: [], showHiddenFiles: true, showAllFiles: false });

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

  describe("trustWorkspace", () => {
    it("does nothing if no config exists", () => {
      const store = useWorkspaceStore.getState();
      store.trustWorkspace();

      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("grants trust to workspace", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.trustWorkspace();

      const state = useWorkspaceStore.getState();
      expect(state.config?.identity?.trustLevel).toBe("trusted");
    });

    it("creates identity if needed before trusting", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path", {
        version: 1,
        excludeFolders: [],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
        // No identity
      });

      // Remove identity to simulate old config
      useWorkspaceStore.setState((s) => ({
        ...s,
        config: { ...s.config!, identity: undefined },
      }));

      store.trustWorkspace();

      const state = useWorkspaceStore.getState();
      expect(state.config?.identity).toBeDefined();
    });
  });

  describe("untrustWorkspace", () => {
    it("does nothing if no config exists", () => {
      const store = useWorkspaceStore.getState();
      store.untrustWorkspace();

      const state = useWorkspaceStore.getState();
      expect(state.config).toBeNull();
    });

    it("does nothing if no identity exists", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");

      // Remove identity
      useWorkspaceStore.setState((s) => ({
        ...s,
        config: { ...s.config!, identity: undefined },
      }));

      store.untrustWorkspace();

      const state = useWorkspaceStore.getState();
      expect(state.config?.identity).toBeUndefined();
    });

    it("revokes trust from workspace", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.trustWorkspace();
      store.untrustWorkspace();

      const state = useWorkspaceStore.getState();
      expect(state.config?.identity?.trustLevel).toBe("untrusted");
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

  describe("isWorkspaceTrusted", () => {
    it("returns false for new workspace", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");

      expect(store.isWorkspaceTrusted()).toBe(false);
    });

    it("returns true after trusting workspace", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.trustWorkspace();

      expect(store.isWorkspaceTrusted()).toBe(true);
    });

    it("returns false after revoking trust", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");
      store.trustWorkspace();
      store.untrustWorkspace();

      expect(store.isWorkspaceTrusted()).toBe(false);
    });

    it("returns false when no config", () => {
      const store = useWorkspaceStore.getState();
      expect(store.isWorkspaceTrusted()).toBe(false);
    });
  });

  describe("getWorkspaceId", () => {
    it("returns null when no config", () => {
      const store = useWorkspaceStore.getState();
      expect(store.getWorkspaceId()).toBeNull();
    });

    it("returns id when workspace is open", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");

      expect(store.getWorkspaceId()).toBe("mock-uuid-1234");
    });

    it("returns null when identity is missing", () => {
      const store = useWorkspaceStore.getState();
      store.openWorkspace("/path");

      // Remove identity
      useWorkspaceStore.setState((s) => ({
        ...s,
        config: { ...s.config!, identity: undefined },
      }));

      expect(store.getWorkspaceId()).toBeNull();
    });
  });

  describe("DEFAULT_EXCLUDED_FOLDERS", () => {
    it("exports expected default folders", () => {
      expect(DEFAULT_EXCLUDED_FOLDERS).toContain(".git");
      expect(DEFAULT_EXCLUDED_FOLDERS).toContain("node_modules");
    });

    it("does not include .vmark (no longer created)", () => {
      expect(DEFAULT_EXCLUDED_FOLDERS).not.toContain(".vmark");
    });
  });

  // openWorkspace and bootstrapConfig both mint a WorkspaceConfig. The store
  // promises every workspace carries an identity (trust gating reads it), and
  // no config may alias the module-level default arrays.
  describe("config normalization is identical on both paths", () => {
    beforeEach(() => {
      useWorkspaceStore.setState({ rootPath: "/path", isWorkspaceMode: true, config: null });
    });

    it("bootstrapConfig creates an identity for a legacy disk config that has none", () => {
      useWorkspaceStore.getState().bootstrapConfig({
        version: 1,
        excludeFolders: ["custom"],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
      });

      expect(useWorkspaceStore.getState().config?.identity?.id).toBe("mock-uuid-1234");
      expect(useWorkspaceStore.getState().getWorkspaceId()).toBe("mock-uuid-1234");
    });

    it("bootstrapConfig creates an identity when there is no disk config at all", () => {
      useWorkspaceStore.getState().bootstrapConfig(null);
      expect(useWorkspaceStore.getState().config?.identity?.id).toBe("mock-uuid-1234");
    });

    it("bootstrapConfig preserves an existing identity", () => {
      const identity = {
        id: "disk-id",
        createdAt: 1,
        trustLevel: "trusted" as const,
        trustedAt: 2,
      };
      useWorkspaceStore.getState().bootstrapConfig({
        version: 1,
        excludeFolders: [],
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
        identity,
      });
      expect(useWorkspaceStore.getState().config?.identity?.id).toBe("disk-id");
    });

    it("does not hand live state the exported DEFAULT_EXCLUDED_FOLDERS array", () => {
      useWorkspaceStore.getState().openWorkspace("/path");
      const config = useWorkspaceStore.getState().config!;
      expect(config.excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
      expect(config.excludeFolders).not.toBe(DEFAULT_EXCLUDED_FOLDERS);

      // A mutation of live state must not corrupt the module default that
      // every future workspace is built from.
      config.excludeFolders.push("mutated");
      expect(DEFAULT_EXCLUDED_FOLDERS).not.toContain("mutated");

      useWorkspaceStore.setState({ config: null });
      useWorkspaceStore.getState().bootstrapConfig(null);
      expect(useWorkspaceStore.getState().config?.excludeFolders).not.toBe(DEFAULT_EXCLUDED_FOLDERS);
      expect(useWorkspaceStore.getState().config?.excludeFolders).not.toContain("mutated");
    });

    it("copies a caller-owned excludeFolders array", () => {
      const callerOwned = ["dist"];
      useWorkspaceStore.getState().openWorkspace("/path", {
        version: 1,
        excludeFolders: callerOwned,
        lastOpenTabs: [],
        showHiddenFiles: false,
        showAllFiles: false,
      });
      expect(useWorkspaceStore.getState().config?.excludeFolders).toEqual(["dist"]);
      expect(useWorkspaceStore.getState().config?.excludeFolders).not.toBe(callerOwned);
    });
  });
});
