/**
 * Tests for useActiveWorkspaceScope, the React adapter over
 * buildActiveWorkspaceScope (whose rules are tested in
 * services/workspaces/activeWorkspaceScope.test.ts).
 *
 * Covers what the adapter itself owns: it reads the real stores, agrees with
 * the non-React getActiveWorkspaceScope for the same state, and RE-RENDERS
 * when the rail setting, the legacy workspace or the window's active instance
 * changes; and an instance active in another window does not leak in.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { useActiveWorkspaceScope } from "./useActiveWorkspaceScope";

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

function addWorkspace(id: string, rootPath: string, windowLabel: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("bad test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({ workspaceInstanceId: id, root: root.root, ownerWindowLabel: windowLabel, createdFrom: "open" }),
  );
}

beforeEach(() => {
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceStore.setState({ rootPath: "/legacy", isWorkspaceMode: true, config: null });
  setRail(false);
});

describe("useActiveWorkspaceScope", () => {
  it("matches getActiveWorkspaceScope for the same store state", () => {
    const { result } = renderHook(() => useActiveWorkspaceScope("main"));

    expect(result.current).toEqual(getActiveWorkspaceScope("main"));
    expect(result.current).toMatchObject({ source: "legacy", rootPath: "/legacy" });
  });

  it("re-renders when the rail is turned on and when the window's active instance changes", () => {
    const { result } = renderHook(() => useActiveWorkspaceScope("main"));

    act(() => setRail(true));
    expect(result.current.source).toBe("legacyFallback");

    act(() => addWorkspace("wsi-a", "/repo-a", "main"));
    act(() => useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a"));
    expect(result.current).toMatchObject({ source: "instance", workspaceInstanceId: "wsi-a", rootPath: "/repo-a" });

    act(() => addWorkspace("wsi-b", "/repo-b", "main"));
    act(() => useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-b"));
    expect(result.current).toMatchObject({ workspaceInstanceId: "wsi-b", rootPath: "/repo-b" });
    expect(result.current).toEqual(getActiveWorkspaceScope("main"));
  });

  it("re-renders when the legacy workspace changes", () => {
    const { result } = renderHook(() => useActiveWorkspaceScope("main"));

    act(() => useWorkspaceStore.setState({ rootPath: "/other", isWorkspaceMode: false }));

    expect(result.current).toMatchObject({ rootPath: "/other", isWorkspaceMode: false });
  });

  it("ignores an instance active in a different window", () => {
    setRail(true);
    addWorkspace("wsi-b", "/repo-b", "doc-2");
    act(() => useWorkspaceInstancesStore.getState().activateWorkspaceInstance("doc-2", "wsi-b"));

    const { result } = renderHook(() => useActiveWorkspaceScope("main"));

    expect(result.current.workspaceInstanceId).toBeNull();
    expect(result.current.source).toBe("legacyFallback");
  });
});
