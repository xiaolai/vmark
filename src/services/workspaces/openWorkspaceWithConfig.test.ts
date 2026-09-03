// WI-13.3 — open-path coordinator integration tests
// WI-17.2 — stable-root config addressing tests
/**
 * Tests for openWorkspaceWithConfig — workspace opening with config loading
 *
 * @module services/workspaces/openWorkspaceWithConfig.test
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

/**
 * Answer `read_workspace_config` with `value` (or reject it) and every OTHER
 * command with null. Command-aware on purpose: the test tier models macOS
 * (src/test/platformDefault.ts), where `openWorkspaceWithConfig` also fires the
 * quarantine strip through the same `invoke` — an order-based
 * `mockResolvedValueOnce` was consumed by that call and the config read saw
 * nothing, which is a test that depended on the host platform, not on the code.
 */
function answerConfigRead(value: unknown, reject = false) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd !== "read_workspace_config") return Promise.resolve(null);
    return reject ? Promise.reject(value) : Promise.resolve(value);
  });
}
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
      general: { ...useSettingsStore.getState().general, workspaceRailMode: false },
    });
  });

  it("reads workspace config from disk via invoke", async () => {
    answerConfigRead(null);

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
    answerConfigRead(config);

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root", config);
    expect(result).toEqual(config);
  });

  it("opens workspace with null config when no config on disk", async () => {
    answerConfigRead(null);

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root", null);
    expect(result).toBeNull();
  });

  it("opens workspace without config on invoke error", async () => {
    answerConfigRead(new Error("File not found"), true);

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root");
    expect(result).toBeNull();
  });

  it("opens workspace without config on non-Error rejection", async () => {
    answerConfigRead("string error", true);

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
    answerConfigRead(config);

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(result).toBe(config);
  });

  it("registers a workspace instance for the target window when rail mode is enabled", async () => {
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
    });
    answerConfigRead(null);

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
    answerConfigRead({ version: 1, excludeFolders: "evil" });

    const result = await openWorkspaceWithConfig("/workspace/root");

    expect(mockOpenWorkspace).toHaveBeenCalledWith("/workspace/root");
    expect(result).toBeNull();
  });
});

describe("isValidWorkspaceConfig (T1/ADR-2 boundary guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(null);
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: false },
    });
  });

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

  // WI-13.3 — File > Open Workspace of an already-railed root performs ONE
  // full context transition, with no duplicate config read by the coordinator.
  it("re-opening a railed root switches context with exactly one read per open", async () => {
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
    });
    mockInvoke.mockResolvedValue(null);

    await openWorkspaceWithConfig("/repo-a", { windowLabel: "main" });
    await openWorkspaceWithConfig("/repo-b", { windowLabel: "main" });
    const idA = selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")!
      .workspaceInstanceIds[0];

    await openWorkspaceWithConfig("/repo-a", { windowLabel: "main" });

    const windowState = selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")!;
    expect(windowState.activeWorkspaceInstanceId).toBe(idA);
    expect(windowState.workspaceInstanceIds).toHaveLength(2);
    // 3 opens → exactly 3 read_workspace_config calls (no coordinator re-read).
    expect(
      mockInvoke.mock.calls.filter(([cmd]) => cmd === "read_workspace_config"),
    ).toHaveLength(3);
  });

  // WI-17.2 — a variant spelling of an already-railed Windows root must read
  // the SAME config file (workspace.rs hashes the exact path string).
  it("resolves a variant spelling to the stored root before reading config", async () => {
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
    });
    mockInvoke.mockResolvedValue(null);
    await openWorkspaceWithConfig("C:\\Repo", { windowLabel: "main", platform: "windows" });

    await openWorkspaceWithConfig("c:/repo", { windowLabel: "main", platform: "windows" });

    expect(mockInvoke).toHaveBeenLastCalledWith("read_workspace_config", {
      rootPath: "C:\\Repo",
    });
    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.workspaceInstanceIds.length,
    ).toBe(1);
  });
});
