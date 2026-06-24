import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import {
  selectActiveWorkspaceInstance,
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "./workspaceInstancesStore";

function instance(
  workspaceInstanceId: string,
  ownerWindowLabel: string,
  displayName = workspaceInstanceId
): WorkspaceInstanceRecord {
  const root = createWorkspaceRootIdentity(`/Users/xiaolai/${displayName}`, {
    displayName,
    platform: "macos",
  });
  if (!root.ok) throw new Error("test root should be valid");
  return createWorkspaceInstance({
    workspaceInstanceId,
    root: root.root,
    ownerWindowLabel,
    createdFrom: "open",
  });
}

beforeEach(() => {
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
});

describe("workspaceInstancesStore", () => {
  it("adds the first instance to a window and activates it", () => {
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(instance("wsi-a", "main"));

    const state = useWorkspaceInstancesStore.getState();
    expect(selectWindowWorkspaceState(state, "main")).toMatchObject({
      windowLabel: "main",
      workspaceInstanceIds: ["wsi-a"],
      activeWorkspaceInstanceId: "wsi-a",
    });
    expect(selectActiveWorkspaceInstance(state, "main")?.workspaceInstanceId).toBe("wsi-a");
  });

  it("keeps repeated add operations idempotent", () => {
    const record = instance("wsi-a", "main");
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(record);
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(record);

    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.workspaceInstanceIds
    ).toEqual(["wsi-a"]);
  });

  it("activates only instances owned by that window", () => {
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(instance("wsi-a", "main"));
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(instance("wsi-b", "doc-1"));

    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-b");
    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.activeWorkspaceInstanceId
    ).toBe("wsi-a");
  });

  it("reorders instances without changing the active instance", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(instance("wsi-a", "main"));
    store.addWorkspaceInstance(instance("wsi-b", "main"));
    store.activateWorkspaceInstance("main", "wsi-a");
    store.reorderWorkspaceInstances("main", ["wsi-b", "wsi-a"]);

    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")).toMatchObject({
      workspaceInstanceIds: ["wsi-b", "wsi-a"],
      activeWorkspaceInstanceId: "wsi-a",
    });
  });

  it("moves an instance between windows without duplicating ownership", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(instance("wsi-a", "main"));
    store.addWorkspaceInstance({ ...instance("wsi-a", "doc-1"), ownerWindowLabel: "doc-1" });

    const state = useWorkspaceInstancesStore.getState();
    expect(selectWindowWorkspaceState(state, "main")?.workspaceInstanceIds).toEqual([]);
    expect(selectWindowWorkspaceState(state, "doc-1")?.workspaceInstanceIds).toEqual(["wsi-a"]);
    expect(state.instances["wsi-a"].ownerWindowLabel).toBe("doc-1");
  });

  it("moves an instance even when the previous owner window state is missing", () => {
    const record = instance("wsi-a", "main");
    useWorkspaceInstancesStore.setState({ instances: { "wsi-a": record }, windows: {} });

    useWorkspaceInstancesStore.getState().addWorkspaceInstance({
      ...record,
      ownerWindowLabel: "doc-1",
    });

    const state = useWorkspaceInstancesStore.getState();
    expect(selectWindowWorkspaceState(state, "main")?.workspaceInstanceIds).toEqual([]);
    expect(selectWindowWorkspaceState(state, "doc-1")?.workspaceInstanceIds).toEqual(["wsi-a"]);
  });

  it("ignores reorder requests for unknown windows", () => {
    useWorkspaceInstancesStore.getState().reorderWorkspaceInstances("missing", ["wsi-a"]);

    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "missing"))
      .toBeNull();
  });

  it("falls back to the first reordered id when the active id is stale", () => {
    const a = instance("wsi-a", "main");
    const b = instance("wsi-b", "main");
    useWorkspaceInstancesStore.setState({
      instances: { "wsi-a": a, "wsi-b": b },
      windows: {
        main: {
          windowLabel: "main",
          workspaceInstanceIds: ["wsi-a", "wsi-b"],
          activeWorkspaceInstanceId: "wsi-stale",
        },
      },
    });

    useWorkspaceInstancesStore.getState().reorderWorkspaceInstances("main", ["wsi-b"]);

    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({
        workspaceInstanceIds: ["wsi-b", "wsi-a"],
        activeWorkspaceInstanceId: "wsi-b",
      });
  });

  it("allows an empty window to stay empty after reorder", () => {
    useWorkspaceInstancesStore.setState({
      instances: {},
      windows: {
        main: {
          windowLabel: "main",
          workspaceInstanceIds: [],
          activeWorkspaceInstanceId: "wsi-stale",
        },
      },
    });

    useWorkspaceInstancesStore.getState().reorderWorkspaceInstances("main", ["wsi-a"]);

    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: [], activeWorkspaceInstanceId: null });
  });

  it("selects the next instance when removing the active one", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(instance("wsi-a", "main"));
    store.addWorkspaceInstance(instance("wsi-b", "main"));
    store.activateWorkspaceInstance("main", "wsi-a");
    store.removeWorkspaceInstance("main", "wsi-a");

    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.activeWorkspaceInstanceId
    ).toBe("wsi-b");
  });

  it("preserves the active instance when removing an inactive one", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(instance("wsi-a", "main"));
    store.addWorkspaceInstance(instance("wsi-b", "main"));
    store.activateWorkspaceInstance("main", "wsi-a");
    store.removeWorkspaceInstance("main", "wsi-b");

    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: ["wsi-a"], activeWorkspaceInstanceId: "wsi-a" });
  });

  it("clears the active id when removing the last instance", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(instance("wsi-a", "main"));

    store.removeWorkspaceInstance("main", "wsi-a");

    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ workspaceInstanceIds: [], activeWorkspaceInstanceId: null });
  });

  it("ignores remove requests for missing ownership", () => {
    useWorkspaceInstancesStore.getState().removeWorkspaceInstance("main", "wsi-missing");

    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toBeNull();
  });

  it("creates a main-window placeholder explicitly and idempotently", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.ensurePlaceholderInstance("main", "wsi-placeholder");
    store.ensurePlaceholderInstance("main", "wsi-placeholder");

    const state = useWorkspaceInstancesStore.getState();
    expect(selectWindowWorkspaceState(state, "main")?.workspaceInstanceIds).toEqual([
      "wsi-placeholder",
    ]);
    expect(state.instances["wsi-placeholder"]).toMatchObject({
      rootId: null,
      rootPath: null,
      displayName: "Untitled",
      createdFrom: "placeholder",
    });
  });

  it("returns null for missing or stale active workspace selections", () => {
    expect(selectActiveWorkspaceInstance(useWorkspaceInstancesStore.getState(), "main"))
      .toBeNull();

    useWorkspaceInstancesStore.setState({
      instances: {},
      windows: {
        main: {
          windowLabel: "main",
          workspaceInstanceIds: ["wsi-stale"],
          activeWorkspaceInstanceId: "wsi-stale",
        },
      },
    });

    expect(selectActiveWorkspaceInstance(useWorkspaceInstancesStore.getState(), "main"))
      .toBeNull();
  });
});
