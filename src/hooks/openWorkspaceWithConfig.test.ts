/**
 * Tests for openWorkspaceWithConfig — workspace opening with config loading
 *
 * @module hooks/openWorkspaceWithConfig.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke, mockOpenWorkspace } = vi.hoisted(() => ({
  mockInvoke: vi.fn(() => Promise.resolve(null)),
  mockOpenWorkspace: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      openWorkspace: mockOpenWorkspace,
    })),
  },
}));

import { openWorkspaceWithConfig } from "./openWorkspaceWithConfig";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";

describe("openWorkspaceWithConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useSettingsStore.setState({
      advanced: { ...useSettingsStore.getState().advanced, workspaceRailMode: false },
    });
  });

  it("reads workspace config from disk via invoke", async () => {
    mockInvoke.mockResolvedValueOnce(null);

    await openWorkspaceWithConfig("/workspace/root");

    expect(mockInvoke).toHaveBeenCalledWith("read_workspace_config", {
      rootPath: "/workspace/root",
    });
  });

  it("opens workspace with config when config exists", async () => {
    const config = {
      version: 1,
      excludeFolders: [".git"],
      lastOpenTabs: [],
      showHiddenFiles: false,
    };
    mockInvoke.mockResolvedValueOnce(config);

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root", config);
    expect(result).toEqual(config);
  });

  it("opens workspace with null config when no config on disk", async () => {
    mockInvoke.mockResolvedValueOnce(null);

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root", null);
    expect(result).toBeNull();
  });

  it("opens workspace without config on invoke error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("File not found"));

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root");
    expect(result).toBeNull();
  });

  it("opens workspace without config on non-Error rejection", async () => {
    mockInvoke.mockRejectedValueOnce("string error");

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root");
    expect(result).toBeNull();
  });

  it("returns the config object from Rust", async () => {
    const config = {
      version: 1,
      excludeFolders: [".git", "node_modules"],
      lastOpenTabs: ["/workspace/root/file.md"],
      showHiddenFiles: false,
    };
    mockInvoke.mockResolvedValueOnce(config);

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(result).toBe(config);
  });

  it("registers a workspace instance for the target window when rail mode is enabled", async () => {
    useSettingsStore.setState({
      advanced: { ...useSettingsStore.getState().advanced, workspaceRailMode: true },
    });
    mockInvoke.mockResolvedValueOnce(null);

    await openWorkspaceWithConfig("/workspace/root", { windowLabel: "doc-1" });

    const state = useWorkspaceInstancesStore.getState();
    const windowState = selectWindowWorkspaceState(state, "doc-1");
    const instanceId = windowState?.workspaceInstanceIds[0];
    expect(instanceId).toBeTruthy();
    expect(instanceId ? state.instances[instanceId]?.rootPath : null).toBe("/workspace/root");
  });

  it("opens with defaults (no config) on a malformed non-null payload (T1/ADR-2)", async () => {
    // tabs/folders wrong-typed and required fields missing — must be rejected
    // loudly rather than propagated into the workspace store.
    mockInvoke.mockResolvedValueOnce({ version: 1, excludeFolders: "evil" });

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root");
    expect(result).toBeNull();
  });
});

describe("isValidWorkspaceConfig (T1/ADR-2 boundary guard)", () => {
  const valid = {
    version: 1,
    excludeFolders: [".git"],
    lastOpenTabs: ["/a.md"],
    showHiddenFiles: true,
  };

  it("accepts a well-formed config (ignoring frontend-only/optional fields)", async () => {
    const { isValidWorkspaceConfig } = await import("./openWorkspaceWithConfig");
    expect(isValidWorkspaceConfig(valid)).toBe(true);
    // showAllFiles is frontend-only (Rust never emits it) — its absence is fine.
    expect(isValidWorkspaceConfig({ ...valid, ai: { x: 1 } })).toBe(true);
  });

  it("rejects null, primitives, and arrays", async () => {
    const { isValidWorkspaceConfig } = await import("./openWorkspaceWithConfig");
    expect(isValidWorkspaceConfig(null)).toBe(false);
    expect(isValidWorkspaceConfig("x")).toBe(false);
    expect(isValidWorkspaceConfig([])).toBe(false);
  });

  it("rejects wrong-typed or missing required fields", async () => {
    const { isValidWorkspaceConfig } = await import("./openWorkspaceWithConfig");
    expect(isValidWorkspaceConfig({ ...valid, excludeFolders: [1, 2] })).toBe(false);
    expect(isValidWorkspaceConfig({ ...valid, lastOpenTabs: "nope" })).toBe(false);
    expect(isValidWorkspaceConfig({ ...valid, showHiddenFiles: "yes" })).toBe(false);
    const { version: _v, ...noVersion } = valid;
    expect(isValidWorkspaceConfig(noVersion)).toBe(false);
  });

  it("handles empty root path", async () => {
    mockInvoke.mockResolvedValueOnce(null);

    await openWorkspaceWithConfig("");

    expect(mockInvoke).toHaveBeenCalledWith("read_workspace_config", {
      rootPath: "",
    });
    expect(mockOpenWorkspace).toHaveBeenCalledWith("", null);
  });

  it("handles paths with special characters", async () => {
    mockInvoke.mockResolvedValueOnce(null);

    await openWorkspaceWithConfig("/Users/test/My Documents/project (v2)");

    expect(mockInvoke).toHaveBeenCalledWith("read_workspace_config", {
      rootPath: "/Users/test/My Documents/project (v2)",
    });
  });
});
