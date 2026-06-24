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

  it("de-duplicates ordered ids so an instance cannot appear twice", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(instance("wsi-a", "main"));
    store.addWorkspaceInstance(instance("wsi-b", "main"));

    useWorkspaceInstancesStore
      .getState()
      .reorderWorkspaceInstances("main", ["wsi-b", "wsi-b", "wsi-a"]);

    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.workspaceInstanceIds,
    ).toEqual(["wsi-b", "wsi-a"]);
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
      kind: "placeholder",
      createdFrom: "placeholder",
    });
  });

  it("creates one loose-files instance per window and activates it", () => {
    const store = useWorkspaceInstancesStore.getState();

    const first = store.ensureLooseInstance("main");
    const second = useWorkspaceInstancesStore.getState().ensureLooseInstance("main");

    expect(first.workspaceInstanceId).toBe(second.workspaceInstanceId);
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({
        workspaceInstanceIds: [first.workspaceInstanceId],
        activeWorkspaceInstanceId: first.workspaceInstanceId,
      });
    expect(useWorkspaceInstancesStore.getState().instances[first.workspaceInstanceId])
      .toMatchObject({
        kind: "loose",
        rootId: null,
        rootPath: null,
        displayName: "Loose Files",
      });
  });

  it("reuses an existing loose instance when no specific id is requested", () => {
    const store = useWorkspaceInstancesStore.getState();
    const first = store.ensureLooseInstance("main");
    const again = useWorkspaceInstancesStore.getState().ensureLooseInstance("main");
    expect(again.workspaceInstanceId).toBe(first.workspaceInstanceId);
  });

  it("renames an existing loose instance to the requested transfer id", () => {
    // Transfer restore acks payload.workspaceInstanceId; if a loose instance
    // already exists under a different id, the requested id must win so the ack
    // and tab ownership reference the same instance (regression guard).
    const store = useWorkspaceInstancesStore.getState();
    const existing = store.ensureLooseInstance("main");
    expect(existing.workspaceInstanceId).not.toBe("wsi-transfer");

    const result = useWorkspaceInstancesStore
      .getState()
      .ensureLooseInstance("main", "wsi-transfer");

    expect(result.workspaceInstanceId).toBe("wsi-transfer");
    const state = useWorkspaceInstancesStore.getState();
    expect(state.instances[existing.workspaceInstanceId]).toBeUndefined();
    expect(state.instances["wsi-transfer"]).toMatchObject({
      kind: "loose",
      rootId: null,
    });
    expect(selectWindowWorkspaceState(state, "main")).toMatchObject({
      workspaceInstanceIds: ["wsi-transfer"],
      activeWorkspaceInstanceId: "wsi-transfer",
    });
  });

  it("keeps the existing loose instance when the requested id already matches", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.ensureLooseInstance("main", "wsi-loose-fixed");
    const again = useWorkspaceInstancesStore
      .getState()
      .ensureLooseInstance("main", "wsi-loose-fixed");
    expect(again.workspaceInstanceId).toBe("wsi-loose-fixed");
    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.workspaceInstanceIds,
    ).toEqual(["wsi-loose-fixed"]);
  });

  it("replaces a placeholder when a real loose instance is created", () => {
    const store = useWorkspaceInstancesStore.getState();
    store.ensurePlaceholderInstance("main", "wsi-placeholder");

    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance("main");

    const state = useWorkspaceInstancesStore.getState();
    expect(state.instances["wsi-placeholder"]).toBeUndefined();
    expect(selectWindowWorkspaceState(state, "main")).toMatchObject({
      workspaceInstanceIds: [loose.workspaceInstanceId],
      activeWorkspaceInstanceId: loose.workspaceInstanceId,
    });
  });

  it("updates tab ownership fields without duplicating tab ids", () => {
    const store = useWorkspaceInstancesStore.getState();
    const loose = store.ensureLooseInstance("main");

    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs(
      loose.workspaceInstanceId,
      ["tab-a", "tab-a", "tab-b"],
      "tab-b",
    );

    expect(useWorkspaceInstancesStore.getState().instances[loose.workspaceInstanceId])
      .toMatchObject({
        tabIds: ["tab-a", "tab-b"],
        activeTabId: "tab-b",
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
