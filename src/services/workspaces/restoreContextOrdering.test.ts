// @vitest-environment node
// WI-13.2 — restore ordering: while a window's hot-exit restore is in flight,
// user rail clicks are declined (not queued into a half-built context); the
// guard always clears, even on restore failure.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(null),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { resetContextGenerations } from "./workspaceContextGeneration";
import {
  beginWindowContextRestore,
  endWindowContextRestore,
  isWindowContextRestoring,
  switchWorkspaceInstance,
} from "./switchWorkspaceInstance";

const W = "main";

function addWorkspace(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("bad test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: W,
      createdFrom: "open",
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetContextGenerations();
  endWindowContextRestore(W);
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
  });
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

describe("restore-in-flight guard (WI-13.2)", () => {
  it("declines a rail switch while the window's restore is in flight", () => {
    beginWindowContextRestore(W);
    expect(isWindowContextRestoring(W)).toBe(true);

    const result = switchWorkspaceInstance(W, "wsi-b");

    expect(result.switched).toBe(false);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
  });

  it("allows the switch again after the restore ends", () => {
    beginWindowContextRestore(W);
    endWindowContextRestore(W);

    expect(switchWorkspaceInstance(W, "wsi-b").switched).toBe(true);
  });

  it("the guard is per-window", () => {
    beginWindowContextRestore("doc-1");

    expect(isWindowContextRestoring(W)).toBe(false);
    expect(switchWorkspaceInstance(W, "wsi-b").switched).toBe(true);
    endWindowContextRestore("doc-1");
  });
});
