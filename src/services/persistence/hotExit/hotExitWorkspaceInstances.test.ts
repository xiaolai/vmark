import { describe, expect, it, beforeEach, vi } from "vitest";
import type { WindowState } from "./types";
import {
  captureWindowWorkspaceInstances,
  restoreWindowWorkspaceInstances,
} from "./workspaceInstances";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";

const { mockWorkspaceRailEnabled } = vi.hoisted(() => ({
  mockWorkspaceRailEnabled: vi.fn(() => false),
}));

vi.mock("@/services/featureFlags/workspaceRailFeatureFlag", () => ({
  isWorkspaceRailEnabled: mockWorkspaceRailEnabled,
}));

function makeWindowState(overrides: Partial<WindowState> = {}): WindowState {
  return {
    window_label: "main",
    is_main_window: true,
    active_tab_id: null,
    tabs: [],
    ui_state: {
      sidebar_visible: true,
      sidebar_width: 260,
      outline_visible: false,
      sidebar_view_mode: "files",
      status_bar_visible: true,
      source_mode_enabled: false,
      focus_mode_enabled: false,
      typewriter_mode_enabled: false,
    },
    geometry: null,
    ...overrides,
  };
}

function makeInstance(workspaceInstanceId: string, ownerWindowLabel = "main") {
  const root = createWorkspaceRootIdentity(`/tmp/${workspaceInstanceId}`);
  if (!root.ok) throw new Error("fixture root failed");
  return createWorkspaceInstance({
    workspaceInstanceId,
    root: root.root,
    ownerWindowLabel,
    createdFrom: "open",
  });
}

describe("hot-exit workspace instance capture", () => {
  beforeEach(() => {
    mockWorkspaceRailEnabled.mockReturnValue(false);
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  });

  it("keeps legacy capture empty while workspace rail mode is disabled", () => {
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(makeInstance("ws-1"));

    expect(captureWindowWorkspaceInstances("main")).toEqual({
      workspace_instance_ids: [],
      active_workspace_instance_id: null,
      workspace_instances: [],
    });
  });

  it("captures ordered instances and active id for one window when enabled", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(makeInstance("ws-1"));
    store.addWorkspaceInstance(makeInstance("ws-2"));
    store.activateWorkspaceInstance("main", "ws-2");
    store.reorderWorkspaceInstances("main", ["ws-2", "ws-1"]);

    expect(captureWindowWorkspaceInstances("main")).toMatchObject({
      workspace_instance_ids: ["ws-2", "ws-1"],
      active_workspace_instance_id: "ws-2",
      workspace_instances: [
        { workspaceInstanceId: "ws-2", ownerWindowLabel: "main" },
        { workspaceInstanceId: "ws-1", ownerWindowLabel: "main" },
      ],
    });
  });

  it("does not leak instances owned by another window", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(makeInstance("main-ws", "main"));
    store.addWorkspaceInstance(makeInstance("doc-ws", "doc-1"));

    expect(captureWindowWorkspaceInstances("main").workspace_instance_ids).toEqual(["main-ws"]);
  });
});

describe("hot-exit workspace instance restore", () => {
  beforeEach(() => {
    mockWorkspaceRailEnabled.mockReturnValue(false);
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  });

  it("ignores v4 workspace instances while workspace rail mode is disabled", () => {
    restoreWindowWorkspaceInstances(
      "main",
      makeWindowState({
        workspace_instance_ids: ["ws-1"],
        active_workspace_instance_id: "ws-1",
        workspace_instances: [makeInstance("ws-1")],
      })
    );

    expect(useWorkspaceInstancesStore.getState().windows.main).toBeUndefined();
  });

  it("restores multiple instances into one window when enabled", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    restoreWindowWorkspaceInstances(
      "main",
      makeWindowState({
        workspace_instance_ids: ["ws-1", "ws-2"],
        active_workspace_instance_id: "ws-2",
        workspace_instances: [makeInstance("ws-1"), makeInstance("ws-2")],
      })
    );

    const state = useWorkspaceInstancesStore.getState();
    expect(state.windows.main.workspaceInstanceIds).toEqual(["ws-1", "ws-2"]);
    expect(state.windows.main.activeWorkspaceInstanceId).toBe("ws-2");
    expect(state.instances["ws-1"]?.ownerWindowLabel).toBe("main");
    expect(state.instances["ws-2"]?.ownerWindowLabel).toBe("main");
  });

  it("filters corrupt instance ids without clearing existing recoverable state", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(makeInstance("existing"));

    restoreWindowWorkspaceInstances(
      "main",
      makeWindowState({
        workspace_instance_ids: ["missing", "ws-1"],
        active_workspace_instance_id: "missing",
        workspace_instances: [makeInstance("ws-1")],
      })
    );

    const state = useWorkspaceInstancesStore.getState();
    expect(state.instances.existing).toBeDefined();
    expect(state.windows.main.workspaceInstanceIds).toEqual(["existing", "ws-1"]);
    expect(state.windows.main.activeWorkspaceInstanceId).toBe("ws-1");
  });
});
