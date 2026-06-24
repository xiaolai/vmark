import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import type { WindowState } from "./types";
import {
  captureWindowWorkspaceInstances,
  reconcileRestoredWindowWorkspaceInstances,
  restoreWindowWorkspaceInstances,
} from "./workspaceInstances";

const { mockWorkspaceRailEnabled } = vi.hoisted(() => ({
  mockWorkspaceRailEnabled: vi.fn(() => true),
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

function makeInstance(workspaceInstanceId: string, rootPath = `/tmp/${workspaceInstanceId}`) {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("fixture root failed");
  return createWorkspaceInstance({
    workspaceInstanceId,
    root: root.root,
    ownerWindowLabel: "main",
    createdFrom: "open",
  });
}

describe("hot-exit workspace instance edge branches", () => {
  beforeEach(() => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useTabStore.setState({ tabs: {}, activeTabId: {}, closedTabs: {}, untitledCounter: 0 });
    useDocumentStore.setState({ documents: {} });
  });

  it("returns an empty capture for enabled rail mode when the window has no state", () => {
    expect(captureWindowWorkspaceInstances("missing")).toEqual({
      workspace_instance_ids: [],
      active_workspace_instance_id: null,
      workspace_instances: [],
    });
  });

  it("falls back from a stale active id and captures the currently active tab", () => {
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(makeInstance("ws-1"));
    const tabId = useTabStore.getState().createTab("main", "/tmp/ws-1/a.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/tmp/ws-1/a.md");
    useWorkspaceInstancesStore.setState((state) => ({
      windows: {
        ...state.windows,
        main: {
          ...state.windows.main,
          activeWorkspaceInstanceId: "stale",
        },
      },
    }));

    expect(captureWindowWorkspaceInstances("main")).toMatchObject({
      workspace_instance_ids: ["ws-1"],
      active_workspace_instance_id: "ws-1",
      workspace_instances: [{ workspaceInstanceId: "ws-1", activeTabId: tabId }],
    });
  });

  it("creates a loose context before capture for placeholder-only unowned tabs", () => {
    useWorkspaceInstancesStore.getState().ensurePlaceholderInstance("main", "placeholder");
    const tabId = useTabStore.getState().createTab("main", null);
    useDocumentStore.getState().initDocument(tabId, "draft", null);

    const captured = captureWindowWorkspaceInstances("main");

    expect(captured.workspace_instances).toMatchObject([
      { kind: "loose", tabIds: [tabId], activeTabId: tabId },
    ]);
  });

  it("returns early when enabled restore has no serialized or synthesizable instances", () => {
    restoreWindowWorkspaceInstances("main", makeWindowState());

    expect(useWorkspaceInstancesStore.getState().windows.main).toBeUndefined();
  });

  it("returns early when enabled reconcile has no instances", () => {
    reconcileRestoredWindowWorkspaceInstances("main", makeWindowState(), new Map());

    expect(useWorkspaceInstancesStore.getState().windows.main).toBeUndefined();
  });

  it("deduplicates mapped tabs and assigns unowned restored tabs to loose files", () => {
    restoreWindowWorkspaceInstances(
      "main",
      makeWindowState({
        active_tab_id: "old-a",
        workspace_instance_ids: ["ws-1"],
        active_workspace_instance_id: "missing",
        workspace_instances: [
          { ...makeInstance("ws-1"), tabIds: ["old-a", "old-a"], activeTabId: "old-a" },
        ],
      }),
    );
    const mappedTabId = useTabStore.getState().createTab("main", "/tmp/ws-1/a.md");
    useDocumentStore.getState().initDocument(mappedTabId, "content", "/tmp/ws-1/a.md");
    const looseTabId = useTabStore.getState().createTab("main", "/outside/b.md");
    useDocumentStore.getState().initDocument(looseTabId, "content", "/outside/b.md");

    reconcileRestoredWindowWorkspaceInstances(
      "main",
      makeWindowState({
        active_tab_id: "old-a",
        active_workspace_instance_id: "missing",
      }),
      new Map([["old-a", mappedTabId]]),
    );

    const state = useWorkspaceInstancesStore.getState();
    const loose = Object.values(state.instances).find((instance) => instance.kind === "loose");
    expect(state.instances["ws-1"]).toMatchObject({
      tabIds: [mappedTabId],
      activeTabId: mappedTabId,
    });
    expect(loose).toMatchObject({ tabIds: [looseTabId], activeTabId: looseTabId });
    expect(state.windows.main.activeWorkspaceInstanceId).toBe("ws-1");
  });

  it("falls back to the first non-placeholder context when no active tab maps", () => {
    const workspace = makeInstance("ws-1");
    const placeholder = createWorkspaceInstance({
      workspaceInstanceId: "placeholder",
      root: null,
      ownerWindowLabel: "main",
      createdFrom: "placeholder",
      kind: "placeholder",
    });
    useWorkspaceInstancesStore.setState({
      instances: { placeholder, "ws-1": workspace },
      windows: {
        main: {
          windowLabel: "main",
          workspaceInstanceIds: ["placeholder", "ws-1"],
          activeWorkspaceInstanceId: "missing",
        },
      },
    });

    reconcileRestoredWindowWorkspaceInstances(
      "main",
      makeWindowState({ active_workspace_instance_id: "missing" }),
      new Map(),
    );

    expect(useWorkspaceInstancesStore.getState().windows.main.activeWorkspaceInstanceId)
      .toBe("ws-1");
  });
});
