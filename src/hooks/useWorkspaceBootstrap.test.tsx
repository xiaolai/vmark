/**
 * Tests for useWorkspaceBootstrap — startup crash-recovery / tab restore.
 *
 * WI-5.1 — backfill for a previously zero-coverage high-risk hook with two
 * silent catch paths (config-read failure, per-file restore failure).
 *
 * Strategy: drive the real useWorkspaceStore so needsBootstrap()/bootstrapConfig()
 * behave authentically (observable config state is asserted), while leaf
 * dependencies (Tauri invoke/fs, hot-exit coordination, dedup guard, tab and
 * document store writes) are mocked so each branch is reachable and verifiable.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";

// --- Mocks (hoisted before the hook import) ---

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockReadTextFile = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

const mockWaitForRestoreComplete = vi.fn();
vi.mock("@/services/persistence/hotExit/hotExitCoordination", () => ({
  RESTORE_WAIT_TIMEOUT_MS: 15_000,
  waitForRestoreComplete: (...args: unknown[]) =>
    mockWaitForRestoreComplete(...args),
}));

const mockFindExistingTabForPath = vi.fn();
vi.mock("@/hooks/useReplaceableTab", () => ({
  findExistingTabForPath: (...args: unknown[]) =>
    mockFindExistingTabForPath(...args),
}));

vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: () => ({ kind: "lf" }),
}));

let createdTabSeq = 0;
const mockCreateTab = vi.fn(() => `tab-${++createdTabSeq}`);
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({ createTab: mockCreateTab }),
  },
}));

const mockInitDocument = vi.fn();
const mockSetLineMetadata = vi.fn();
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      initDocument: mockInitDocument,
      setLineMetadata: mockSetLineMetadata,
    }),
  },
}));

const mockWorkspaceWarn = vi.fn();
vi.mock("@/utils/debug", () => ({
  workspaceWarn: (...args: unknown[]) => mockWorkspaceWarn(...args),
}));

// Import AFTER mocks are registered (vitest hoists vi.mock).
const { useWorkspaceBootstrap } = await import("./useWorkspaceBootstrap");

function makeConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    version: 1,
    excludeFolders: [".git", "node_modules"],
    lastOpenTabs: [],
    showHiddenFiles: false,
    showAllFiles: false,
    ...overrides,
  };
}

/** Put the store into a state where needsBootstrap() returns true. */
function enterWorkspaceNeedingBootstrap(rootPath = "/ws") {
  useWorkspaceStore.setState({
    rootPath,
    isWorkspaceMode: true,
    config: null,
  });
}

beforeEach(() => {
  createdTabSeq = 0;
  mockInvoke.mockReset();
  mockReadTextFile.mockReset();
  mockWaitForRestoreComplete.mockReset().mockResolvedValue(true);
  mockFindExistingTabForPath.mockReset().mockReturnValue(null);
  mockCreateTab.mockClear();
  mockInitDocument.mockClear();
  mockSetLineMetadata.mockClear();
  mockWorkspaceWarn.mockClear();
  // Reset workspace store to a clean, non-workspace state.
  useWorkspaceStore.setState({
    rootPath: null,
    isWorkspaceMode: false,
    config: null,
  });
});

describe("useWorkspaceBootstrap", () => {
  it("does nothing when bootstrap is not needed (not in workspace mode)", async () => {
    // Default beforeEach state: isWorkspaceMode false.
    renderHook(() => useWorkspaceBootstrap());

    // Give any (unexpected) async work a chance to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().config).toBeNull();
  });

  it("handles a null config gracefully (no crash, applies default config, no tabs)", async () => {
    enterWorkspaceNeedingBootstrap("/ws");
    mockInvoke.mockResolvedValue(null);

    renderHook(() => useWorkspaceBootstrap());

    await waitFor(() => {
      expect(useWorkspaceStore.getState().config).not.toBeNull();
    });

    expect(mockInvoke).toHaveBeenCalledWith("read_workspace_config", {
      rootPath: "/ws",
    });
    // bootstrapConfig(null) falls back to DEFAULT_CONFIG.
    expect(useWorkspaceStore.getState().config).toEqual(makeConfig());
    expect(mockCreateTab).not.toHaveBeenCalled();
  });

  it("restores tabs from a valid config's lastOpenTabs", async () => {
    enterWorkspaceNeedingBootstrap("/ws");
    const config = makeConfig({
      showHiddenFiles: true,
      lastOpenTabs: ["/ws/a.md", "/ws/b.md"],
    });
    mockInvoke.mockResolvedValue(config);
    mockReadTextFile.mockImplementation((p: string) =>
      Promise.resolve(`content-of-${p}`)
    );

    renderHook(() => useWorkspaceBootstrap());

    await waitFor(() => {
      expect(mockInitDocument).toHaveBeenCalledTimes(2);
    });

    // Config applied to the store (observable state, not just a mock call).
    expect(useWorkspaceStore.getState().config?.showHiddenFiles).toBe(true);
    expect(useWorkspaceStore.getState().config?.lastOpenTabs).toEqual([
      "/ws/a.md",
      "/ws/b.md",
    ]);

    // Both files restored as tabs, in order, with their content.
    expect(mockCreateTab).toHaveBeenNthCalledWith(1, "main", "/ws/a.md");
    expect(mockCreateTab).toHaveBeenNthCalledWith(2, "main", "/ws/b.md");
    expect(mockInitDocument).toHaveBeenNthCalledWith(
      1,
      "tab-1",
      "content-of-/ws/a.md",
      "/ws/a.md"
    );
    expect(mockInitDocument).toHaveBeenNthCalledWith(
      2,
      "tab-2",
      "content-of-/ws/b.md",
      "/ws/b.md"
    );
    expect(mockSetLineMetadata).toHaveBeenCalledTimes(2);
  });

  it("exercises the config-read silent-catch path: invoke throws → app continues with defaults", async () => {
    enterWorkspaceNeedingBootstrap("/ws");
    const failure = new Error("read_workspace_config blew up");
    mockInvoke.mockRejectedValue(failure);

    renderHook(() => useWorkspaceBootstrap());

    // Catch path applies DEFAULT_CONFIG instead of leaving config null.
    await waitFor(() => {
      expect(useWorkspaceStore.getState().config).not.toBeNull();
    });

    expect(useWorkspaceStore.getState().config).toEqual(makeConfig());
    // No tab restore attempted on the failure path.
    expect(mockCreateTab).not.toHaveBeenCalled();
    // The silent catch logged via workspaceWarn (regression sentinel).
    expect(mockWorkspaceWarn).toHaveBeenCalledWith(
      "Failed to load workspace config:",
      failure
    );
  });

  it("exercises the per-file silent-catch path: a missing file is skipped, others still restore", async () => {
    enterWorkspaceNeedingBootstrap("/ws");
    mockInvoke.mockResolvedValue(
      makeConfig({ lastOpenTabs: ["/ws/gone.md", "/ws/ok.md"] })
    );
    mockReadTextFile.mockImplementation((p: string) => {
      if (p === "/ws/gone.md") return Promise.reject(new Error("ENOENT"));
      return Promise.resolve("ok-content");
    });

    renderHook(() => useWorkspaceBootstrap());

    await waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledTimes(1);
    });

    // Only the surviving file became a tab; the failed one was swallowed.
    expect(mockCreateTab).toHaveBeenCalledWith("main", "/ws/ok.md");
    expect(mockInitDocument).toHaveBeenCalledTimes(1);
    expect(mockInitDocument).toHaveBeenCalledWith(
      "tab-1",
      "ok-content",
      "/ws/ok.md"
    );
    // The per-file catch warns with the skipped path (regression sentinel).
    expect(mockWorkspaceWarn).toHaveBeenCalledWith(
      "Could not restore tab: /ws/gone.md"
    );
  });

  it("does not create a duplicate tab for a file already open (dedup guard)", async () => {
    enterWorkspaceNeedingBootstrap("/ws");
    mockInvoke.mockResolvedValue(
      makeConfig({ lastOpenTabs: ["/ws/open.md", "/ws/new.md"] })
    );
    mockReadTextFile.mockResolvedValue("content");
    // First path already has a tab; second does not.
    mockFindExistingTabForPath.mockImplementation(
      (_label: string, path: string) =>
        path === "/ws/open.md" ? "existing-tab" : null
    );

    renderHook(() => useWorkspaceBootstrap());

    await waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledTimes(1);
    });

    // Only the not-yet-open file was created; the duplicate was skipped.
    expect(mockCreateTab).toHaveBeenCalledWith("main", "/ws/new.md");
    expect(mockReadTextFile).not.toHaveBeenCalledWith("/ws/open.md");
    expect(mockReadTextFile).toHaveBeenCalledWith("/ws/new.md");
  });

  it("warns but proceeds when hot-exit restore times out", async () => {
    enterWorkspaceNeedingBootstrap("/ws");
    mockWaitForRestoreComplete.mockResolvedValue(false);
    mockInvoke.mockResolvedValue(makeConfig({ lastOpenTabs: ["/ws/a.md"] }));
    mockReadTextFile.mockResolvedValue("content");

    renderHook(() => useWorkspaceBootstrap());

    await waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledTimes(1);
    });

    expect(mockWorkspaceWarn).toHaveBeenCalledWith(
      "Hot exit restore timed out, proceeding with dedup guard"
    );
  });

  it("hasBootstrapped guard: re-render does not re-run the restore", async () => {
    enterWorkspaceNeedingBootstrap("/ws");
    mockInvoke.mockResolvedValue(makeConfig({ lastOpenTabs: ["/ws/a.md"] }));
    mockReadTextFile.mockResolvedValue("content");

    const { rerender } = renderHook(() => useWorkspaceBootstrap());

    await waitFor(() => {
      expect(mockCreateTab).toHaveBeenCalledTimes(1);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Re-render the same hook instance — the guard must prevent a second run.
    rerender();
    rerender();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockCreateTab).toHaveBeenCalledTimes(1);
  });
});
