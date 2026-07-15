import { describe, expect, it, beforeEach, vi } from "vitest";
import type { WindowState } from "./types";
import {
  captureWindowWorkspaceInstances,
  reconcileRestoredWindowWorkspaceInstances,
  restoreWindowWorkspaceInstances,
} from "./workspaceInstances";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import type { TabState } from "./types";

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

function makeTab(id: string, filePath: string | null): TabState {
  return {
    id,
    file_path: filePath,
    title: id,
    is_pinned: false,
    format_id: "markdown",
    editing_enabled: true,
    active_schema_id: null,
    document: {
      content: "content",
      saved_content: "content",
      is_dirty: false,
      is_missing: false,
      is_divergent: false,
      line_ending: "\n",
      cursor_info: null,
      last_modified_timestamp: null,
      is_untitled: filePath === null,
      untitled_number: filePath === null ? 1 : null,
      undo_history: [],
      redo_history: [],
    },
  };
}

describe("hot-exit workspace instance capture", () => {
  beforeEach(() => {
    mockWorkspaceRailEnabled.mockReturnValue(false);
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useTabStore.setState({ tabs: {}, activeTabId: {}, closedTabs: {}, untitledCounter: 0 });
    useDocumentStore.setState({ documents: {} });
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
    useTabStore.setState({ tabs: {}, activeTabId: {}, closedTabs: {}, untitledCounter: 0 });
    useDocumentStore.setState({ documents: {} });
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

  it("synthesizes workspace and loose instances for legacy windows with tabs", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);

    restoreWindowWorkspaceInstances(
      "main",
      makeWindowState({
        active_tab_id: "tab-loose",
        tabs: [
          makeTab("tab-in-workspace", "/repo/a.md"),
          makeTab("tab-loose", "/outside/b.md"),
          makeTab("tab-untitled", null),
        ],
        workspace_instances: [],
        workspace_instance_ids: [],
      }),
      { legacyWorkspaceRoot: "/repo" },
    );

    const state = useWorkspaceInstancesStore.getState();
    const instances = state.windows.main.workspaceInstanceIds.map((id) => state.instances[id]);
    expect(instances).toMatchObject([
      { kind: "workspace", rootPath: "/repo", tabIds: ["tab-in-workspace"] },
      { kind: "loose", rootPath: null, tabIds: ["tab-loose", "tab-untitled"] },
    ]);
    expect(state.windows.main.activeWorkspaceInstanceId).toBe(instances[1].workspaceInstanceId);
  });

  it("reconciles restored tab ids after hot-exit tab recreation", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    restoreWindowWorkspaceInstances(
      "main",
      makeWindowState({
        active_tab_id: "old-a",
        workspace_instance_ids: ["ws-1"],
        active_workspace_instance_id: "ws-1",
        workspace_instances: [{ ...makeInstance("ws-1"), tabIds: ["old-a"], activeTabId: "old-a" }],
      }),
    );
    const newTabId = useTabStore.getState().createTab("main", "/tmp/ws-1/a.md");
    useDocumentStore.getState().initDocument(newTabId, "content", "/tmp/ws-1/a.md");

    reconcileRestoredWindowWorkspaceInstances(
      "main",
      makeWindowState({
        active_tab_id: "old-a",
        workspace_instance_ids: ["ws-1"],
        active_workspace_instance_id: "ws-1",
        workspace_instances: [{ ...makeInstance("ws-1"), tabIds: ["old-a"], activeTabId: "old-a" }],
      }),
      new Map([["old-a", newTabId]]),
    );

    expect(useWorkspaceInstancesStore.getState().instances["ws-1"]).toMatchObject({
      tabIds: [newTabId],
      activeTabId: newTabId,
    });
  });

  it("does not keep stale active tab ids when restored tabs are not recreated", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    restoreWindowWorkspaceInstances(
      "main",
      makeWindowState({
        workspace_instance_ids: ["ws-1"],
        active_workspace_instance_id: "ws-1",
        workspace_instances: [{ ...makeInstance("ws-1"), tabIds: ["old-a"], activeTabId: "old-a" }],
      }),
    );

    reconcileRestoredWindowWorkspaceInstances(
      "main",
      makeWindowState({
        workspace_instance_ids: ["ws-1"],
        active_workspace_instance_id: "ws-1",
        workspace_instances: [{ ...makeInstance("ws-1"), tabIds: ["old-a"], activeTabId: "old-a" }],
      }),
      new Map(),
    );

    expect(useWorkspaceInstancesStore.getState().instances["ws-1"]).toMatchObject({
      tabIds: [],
      activeTabId: null,
    });
  });

  it("remaps restored closed tab ids and drops stale ones", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    restoreWindowWorkspaceInstances(
      "main",
      makeWindowState({
        workspace_instance_ids: ["ws-1"],
        active_workspace_instance_id: "ws-1",
        workspace_instances: [{
          ...makeInstance("ws-1"),
          closedTabIds: ["old-closed", "missing-closed"],
        }],
      }),
    );

    reconcileRestoredWindowWorkspaceInstances(
      "main",
      makeWindowState({
        workspace_instance_ids: ["ws-1"],
        active_workspace_instance_id: "ws-1",
        workspace_instances: [{
          ...makeInstance("ws-1"),
          closedTabIds: ["old-closed", "missing-closed"],
        }],
      }),
      new Map([["old-closed", "new-closed"]]),
    );

    expect(useWorkspaceInstancesStore.getState().instances["ws-1"]?.closedTabIds)
      .toEqual(["new-closed"]);
  });

  it("gives a recreated tab to exactly one instance when two instances claim it", () => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    const windowState = makeWindowState({
      workspace_instance_ids: ["ws-1", "ws-2"],
      active_workspace_instance_id: "ws-1",
      workspace_instances: [
        { ...makeInstance("ws-1"), tabIds: ["old-a"], activeTabId: "old-a" },
        { ...makeInstance("ws-2"), tabIds: ["old-a"], activeTabId: "old-a" },
      ],
    });
    restoreWindowWorkspaceInstances("main", windowState);

    const newTabId = useTabStore.getState().createTab("main", "/tmp/ws-1/a.md");
    useDocumentStore.getState().initDocument(newTabId, "content", "/tmp/ws-1/a.md");

    reconcileRestoredWindowWorkspaceInstances(
      "main",
      windowState,
      new Map([["old-a", newTabId]]),
    );

    const state = useWorkspaceInstancesStore.getState();
    const owners = ["ws-1", "ws-2"].filter((id) =>
      state.instances[id]?.tabIds.includes(newTabId),
    );
    // Exclusive ownership: a recreated tab must not live in two workspaces.
    expect(owners).toEqual(["ws-1"]);
    expect(state.instances["ws-2"]?.tabIds).toEqual([]);
  });
});

describe("hot-exit capture does not mutate live workspace activation", () => {
  beforeEach(() => {
    mockWorkspaceRailEnabled.mockReturnValue(true);
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useTabStore.setState({ tabs: {}, activeTabId: {}, closedTabs: {}, untitledCounter: 0 });
    useDocumentStore.setState({ documents: {} });
  });

  it("keeps the user's active workspace instance when an unowned tab forces a loose context", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(makeInstance("ws-1"));
    store.activateWorkspaceInstance("main", "ws-1");

    // A tab outside every workspace root — capture must ensure a loose context
    // owns it, but that repair must not switch the ACTIVE workspace instance.
    const tabId = useTabStore.getState().createTab("main", "/elsewhere/loose.md");
    useDocumentStore.getState().initDocument(tabId, "loose", "/elsewhere/loose.md");

    const captured = captureWindowWorkspaceInstances("main");

    expect(captured.active_workspace_instance_id).toBe("ws-1");
    expect(
      useWorkspaceInstancesStore.getState().windows.main.activeWorkspaceInstanceId,
    ).toBe("ws-1");
  });
});
