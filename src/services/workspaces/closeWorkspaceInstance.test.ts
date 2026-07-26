/**
 * Tests for closing a workspace instance from the rail.
 *
 * The rail had no close affordance at all: the only way to remove a workspace
 * was dragging its icon outside the window, which is undiscoverable and easy to
 * trigger by accident. `removeWorkspaceInstance` alone is not enough — it drops
 * the instance from the store while its TABS keep existing, so closing has to
 * route through the same dirty-check path the tab bar uses, and must abort
 * cleanly when the user cancels a save prompt.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const closeTabsWithDirtyCheck = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { closeWorkspaceInstance } from "./closeWorkspaceInstance";

function seedInstance(windowLabel: string, instanceId: string, path: string, tabIds: string[]) {
  const rootResult = createWorkspaceRootIdentity(path);
  const root = rootResult.ok ? rootResult.root : null;
  const instance = {
    ...createWorkspaceInstance({
      workspaceInstanceId: instanceId,
      root,
      ownerWindowLabel: windowLabel,
      createdFrom: "open",
    }),
    tabIds,
  };
  useWorkspaceInstancesStore.setState((state) => ({
    instances: { ...state.instances, [instanceId]: instance },
    windows: {
      ...state.windows,
      [windowLabel]: {
        windowLabel,
        workspaceInstanceIds: [
          ...(state.windows[windowLabel]?.workspaceInstanceIds ?? []),
          instanceId,
        ],
        activeWorkspaceInstanceId:
          state.windows[windowLabel]?.activeWorkspaceInstanceId ?? instanceId,
      },
    },
  }));
}

const idsIn = (windowLabel: string) =>
  useWorkspaceInstancesStore.getState().windows[windowLabel]?.workspaceInstanceIds ?? [];

beforeEach(() => {
  useWorkspaceInstancesStore.setState({ instances: {}, windows: {} });
  closeTabsWithDirtyCheck.mockReset().mockResolvedValue(true);
  invoke.mockReset().mockResolvedValue(undefined);
});

describe("closeWorkspaceInstance", () => {
  it("closes the workspace's tabs through the shared dirty-check path", async () => {
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1", "tab-2"]);

    await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(closeTabsWithDirtyCheck).toHaveBeenCalledWith("doc-1", ["tab-1", "tab-2"]);
  });

  it("removes the instance once its tabs are closed", async () => {
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1"]);
    seedInstance("doc-1", "wsi-b", "/tmp/beta", ["tab-2"]);

    const result = await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(result.ok).toBe(true);
    expect(idsIn("doc-1")).toEqual(["wsi-b"]);
    expect(useWorkspaceInstancesStore.getState().instances["wsi-a"]).toBeUndefined();
  });

  it("does NOT remove the instance when the user cancels a save prompt", async () => {
    // The critical case: a cancelled prompt must leave the workspace and its
    // unsaved work exactly where they were, not half-closed.
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1"]);
    closeTabsWithDirtyCheck.mockResolvedValue(false);

    const result = await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("cancelled");
    expect(idsIn("doc-1")).toEqual(["wsi-a"]);
    expect(useWorkspaceInstancesStore.getState().instances["wsi-a"]).toBeDefined();
  });

  it("keeps the main window non-empty by seeding a placeholder", async () => {
    // main is never closed, so it must always hold at least one instance —
    // the same invariant moveWorkspaceInstanceToNewWindow maintains.
    seedInstance("main", "wsi-only", "/tmp/only", ["tab-1"]);

    await closeWorkspaceInstance("main", "wsi-only", { closeTabs: closeTabsWithDirtyCheck });

    const ids = idsIn("main");
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe("wsi-only");
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("closes a non-main window once its last workspace is gone", async () => {
    seedInstance("doc-2", "wsi-only", "/tmp/only", ["tab-1"]);

    await closeWorkspaceInstance("doc-2", "wsi-only", { closeTabs: closeTabsWithDirtyCheck });

    expect(invoke).toHaveBeenCalledWith("close_window", { label: "doc-2" });
  });

  it("leaves other windows alone when one still holds a workspace", async () => {
    seedInstance("doc-2", "wsi-a", "/tmp/alpha", ["tab-1"]);
    seedInstance("doc-2", "wsi-b", "/tmp/beta", ["tab-2"]);

    await closeWorkspaceInstance("doc-2", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("reports a missing instance instead of throwing", async () => {
    const result = await closeWorkspaceInstance("doc-1", "nope", { closeTabs: closeTabsWithDirtyCheck });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing");
    expect(closeTabsWithDirtyCheck).not.toHaveBeenCalled();
  });
});
