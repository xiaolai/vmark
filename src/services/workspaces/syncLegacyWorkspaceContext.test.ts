// @vitest-environment node
// WI-5R — legacy workspace store follows rail activation: synchronous re-root
// (tree and tabs switch together), generation-guarded async config refresh,
// loose AND placeholder clear the legacy root, malformed config → defaults.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(null),
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  bumpContextGeneration,
  resetContextGenerations,
} from "./workspaceContextGeneration";
import { syncLegacyWorkspaceContext } from "./syncLegacyWorkspaceContext";

const W = "main";

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

const VALID_CONFIG = {
  version: 1,
  excludeFolders: ["node_modules"],
  lastOpenTabs: [],
  showHiddenFiles: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(null);
  resetContextGenerations();
  useWorkspaceStore.getState().closeWorkspace();
  setRail(true);
});

describe("syncLegacyWorkspaceContext (WI-5R)", () => {
  it("re-roots SYNCHRONOUSLY, then refreshes config from disk", async () => {
    mockInvoke.mockResolvedValueOnce(VALID_CONFIG);
    const gen = bumpContextGeneration(W);

    const refresh = syncLegacyWorkspaceContext(
      W,
      { kind: "workspace", rootPath: "/repo-b" },
      gen,
    );

    // Synchronous: root flipped before any await.
    expect(useWorkspaceStore.getState().rootPath).toBe("/repo-b");
    expect(useWorkspaceStore.getState().isWorkspaceMode).toBe(true);

    await refresh;
    expect(useWorkspaceStore.getState().config?.showHiddenFiles).toBe(true);
    expect(useWorkspaceStore.getState().config?.excludeFolders).toEqual(["node_modules"]);
    expect(mockInvoke).toHaveBeenCalledWith("read_workspace_config", { rootPath: "/repo-b" });
  });

  it("loose activation clears the legacy store", async () => {
    useWorkspaceStore.getState().openWorkspace("/old-root");
    const gen = bumpContextGeneration(W);

    await syncLegacyWorkspaceContext(W, { kind: "loose", rootPath: null }, gen);

    expect(useWorkspaceStore.getState().rootPath).toBeNull();
    expect(useWorkspaceStore.getState().isWorkspaceMode).toBe(false);
  });

  it("placeholder activation ALSO clears the legacy store (stale-tree bug)", async () => {
    useWorkspaceStore.getState().openWorkspace("/old-root");
    const gen = bumpContextGeneration(W);

    await syncLegacyWorkspaceContext(W, { kind: "placeholder", rootPath: null }, gen);

    expect(useWorkspaceStore.getState().rootPath).toBeNull();
    expect(useWorkspaceStore.getState().isWorkspaceMode).toBe(false);
  });

  it("config read rejection keeps the synchronous defaults (no throw)", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("disk gone"));
    const gen = bumpContextGeneration(W);

    await expect(
      syncLegacyWorkspaceContext(W, { kind: "workspace", rootPath: "/repo-b" }, gen),
    ).resolves.toBeUndefined();

    expect(useWorkspaceStore.getState().rootPath).toBe("/repo-b");
    expect(useWorkspaceStore.getState().config).not.toBeNull();
  });

  it("malformed config payload keeps defaults (no throw)", async () => {
    mockInvoke.mockResolvedValueOnce({ version: "nope" });
    const gen = bumpContextGeneration(W);

    await syncLegacyWorkspaceContext(W, { kind: "workspace", rootPath: "/repo-b" }, gen);

    expect(useWorkspaceStore.getState().rootPath).toBe("/repo-b");
    // Defaults applied, not the malformed payload.
    expect(useWorkspaceStore.getState().config?.showHiddenFiles).toBe(false);
  });

  it("a stale async completion cannot clobber a newer switch (race)", async () => {
    // A's read resolves SLOWLY with A's config; B's resolves fast.
    let resolveA: (v: unknown) => void = () => {};
    const slowA = new Promise((resolve) => { resolveA = resolve; });
    mockInvoke.mockImplementationOnce(() => slowA as Promise<unknown>);
    const genA = bumpContextGeneration(W);
    const refreshA = syncLegacyWorkspaceContext(
      W, { kind: "workspace", rootPath: "/repo-a" }, genA,
    );

    mockInvoke.mockResolvedValueOnce(VALID_CONFIG);
    const genB = bumpContextGeneration(W);
    const refreshB = syncLegacyWorkspaceContext(
      W, { kind: "workspace", rootPath: "/repo-b" }, genB,
    );
    await refreshB;

    // Now A's slow read lands — it must be DISCARDED.
    resolveA({ ...VALID_CONFIG, excludeFolders: ["A-ONLY"] });
    await refreshA;

    expect(useWorkspaceStore.getState().rootPath).toBe("/repo-b");
    expect(useWorkspaceStore.getState().config?.excludeFolders).toEqual(["node_modules"]);
  });

  it("stale generation at CALL time does not even re-root synchronously", () => {
    useWorkspaceStore.getState().openWorkspace("/current");
    const stale = bumpContextGeneration(W);
    bumpContextGeneration(W); // window moved on

    void syncLegacyWorkspaceContext(W, { kind: "workspace", rootPath: "/stale" }, stale);

    expect(useWorkspaceStore.getState().rootPath).toBe("/current");
  });

  it("rail off → no store writes", async () => {
    setRail(false);
    useWorkspaceStore.getState().openWorkspace("/current");
    const gen = bumpContextGeneration(W);

    await syncLegacyWorkspaceContext(W, { kind: "workspace", rootPath: "/other" }, gen);

    expect(useWorkspaceStore.getState().rootPath).toBe("/current");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
