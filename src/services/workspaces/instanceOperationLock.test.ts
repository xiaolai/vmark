// @vitest-environment node
// Audit 20260831 R2-14 — ONE per-instance operation lock across close, move
// and duplicate. The separate `closing`/`transferring` sets it replaced
// excluded close-vs-close and move-vs-move but let a close start during a
// move's ack wait; these tests pin the cross-operation exclusion.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import { closeWorkspaceInstance } from "./closeWorkspaceInstance";
import {
  acquireInstanceOperation,
  releaseInstanceOperation,
  resetInstanceOperationLocks,
} from "./instanceOperationLock";
import {
  duplicateWorkspaceInstanceToNewWindow,
  moveWorkspaceInstanceToNewWindow,
} from "./workspaceWindowActions";

const W = "main";

function seedInstance(instanceId: string, path: string): void {
  const rootResult = createWorkspaceRootIdentity(path, { platform: "macos" });
  if (!rootResult.ok) throw new Error("bad test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: instanceId,
      root: rootResult.root,
      ownerWindowLabel: W,
      createdFrom: "open",
    }),
  );
}

beforeEach(() => {
  resetInstanceOperationLocks();
  useWorkspaceInstancesStore.setState({ instances: {}, windows: {} });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
  });
  invoke.mockReset().mockResolvedValue(undefined);
});

describe("the lock primitive", () => {
  it("acquire → held → release → acquirable again", () => {
    expect(acquireInstanceOperation("wsi-a")).toBe(true);
    expect(acquireInstanceOperation("wsi-a")).toBe(false);
    releaseInstanceOperation("wsi-a");
    expect(acquireInstanceOperation("wsi-a")).toBe(true);
  });

  it("locks are per-instance, not global", () => {
    expect(acquireInstanceOperation("wsi-a")).toBe(true);
    expect(acquireInstanceOperation("wsi-b")).toBe(true);
  });
});

describe("cross-operation exclusion (R2-14)", () => {
  it("close reports busy while ANY operation holds the instance's lock", async () => {
    seedInstance("wsi-a", "/repo-a");
    expect(acquireInstanceOperation("wsi-a")).toBe(true); // e.g. a move mid-ack

    const result = await closeWorkspaceInstance(W, "wsi-a", {
      closeTabs: vi.fn(async () => true),
    });

    expect(result).toEqual({ ok: false, reason: "busy" });
    // Nothing was removed — the holder still owns the instance.
    expect(useWorkspaceInstancesStore.getState().instances["wsi-a"]).toBeDefined();
  });

  it("move reports busy while the lock is held", async () => {
    seedInstance("wsi-a", "/repo-a");
    expect(acquireInstanceOperation("wsi-a")).toBe(true); // e.g. a close at a prompt

    const result = await moveWorkspaceInstanceToNewWindow(W, "wsi-a");

    expect(result).toEqual({ ok: false, reason: "busy" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("duplicate reports busy while the lock is held", async () => {
    seedInstance("wsi-a", "/repo-a");
    expect(acquireInstanceOperation("wsi-a")).toBe(true);

    const result = await duplicateWorkspaceInstanceToNewWindow(W, "wsi-a");

    expect(result).toEqual({ ok: false, reason: "busy" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a refused operation does NOT release the holder's lock", async () => {
    seedInstance("wsi-a", "/repo-a");
    expect(acquireInstanceOperation("wsi-a")).toBe(true);

    await moveWorkspaceInstanceToNewWindow(W, "wsi-a");
    await duplicateWorkspaceInstanceToNewWindow(W, "wsi-a");

    // Still held — the busy path must not run the release in its finally
    // against a lock it never acquired.
    expect(acquireInstanceOperation("wsi-a")).toBe(false);
  });

  it("operations on DIFFERENT instances do not exclude each other", async () => {
    seedInstance("wsi-a", "/repo-a");
    seedInstance("wsi-b", "/repo-b");
    expect(acquireInstanceOperation("wsi-a")).toBe(true);

    const result = await closeWorkspaceInstance(W, "wsi-b", {
      closeTabs: vi.fn(async () => true),
    });

    expect(result.ok).toBe(true);
  });
});
