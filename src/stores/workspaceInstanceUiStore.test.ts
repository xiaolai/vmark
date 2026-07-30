// WI-9.1 — per-instance UI state: sidebar, file-tree, and outline
// presentation state keyed by workspaceInstanceId, with the full lifecycle
// (copy on duplicate, re-key on identity migration, remove on close).
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INSTANCE_UI_STATE,
  useWorkspaceInstanceUiStore,
} from "./workspaceInstanceUiStore";

beforeEach(() => {
  useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
});

describe("workspaceInstanceUiStore", () => {
  it("returns defaults for an unknown instance", () => {
    const state = useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a");
    expect(state).toEqual(DEFAULT_INSTANCE_UI_STATE);
  });

  it("updates and reads back per-instance state independently (A/B round trip)", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-a", { sidebarWidth: 300, sidebarViewMode: "files" });
    store.updateInstanceUiState("wsi-b", { sidebarWidth: 180 });

    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a")).toMatchObject({
      sidebarWidth: 300,
      sidebarViewMode: "files",
    });
    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-b")).toMatchObject({
      sidebarWidth: 180,
      sidebarViewMode: null,
    });
  });

  it("stores file-explorer open state and a finite scroll offset", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-a", {
      fileExplorerOpenState: { "/repo/docs": true },
      fileTreeScrollOffset: 120.5,
    });

    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a")).toMatchObject({
      fileExplorerOpenState: { "/repo/docs": true },
      fileTreeScrollOffset: 120.5,
    });
  });

  it("rejects a non-finite scroll offset (kept at previous value)", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-a", { fileTreeScrollOffset: 50 });
    store.updateInstanceUiState("wsi-a", { fileTreeScrollOffset: Number.NaN });
    store.updateInstanceUiState("wsi-a", { fileTreeScrollOffset: Infinity });

    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").fileTreeScrollOffset,
    ).toBe(50);
  });

  it("tracks outline state per (instance, tab) and removes it on tab close", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateOutlineTabState("wsi-a", "tab-1", {
      collapsedKeys: ["h1:intro"],
      filterQuery: "set",
    });
    store.updateOutlineTabState("wsi-a", "tab-2", { scrollOffset: 33 });

    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").outlineByTabId["tab-1"],
    ).toMatchObject({ collapsedKeys: ["h1:intro"], filterQuery: "set" });

    store.removeOutlineTabState("wsi-a", "tab-1");
    const after = useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a");
    expect(after.outlineByTabId["tab-1"]).toBeUndefined();
    expect(after.outlineByTabId["tab-2"]).toMatchObject({ scrollOffset: 33 });
  });

  it("copy duplicates state without linking the two entries", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-a", { sidebarWidth: 300 });
    store.copyInstanceUiState("wsi-a", "wsi-dup");
    store.updateInstanceUiState("wsi-dup", { sidebarWidth: 111 });

    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").sidebarWidth).toBe(300);
    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-dup").sidebarWidth).toBe(111);
  });

  it("copy deep-clones nested maps and outline arrays (no aliasing)", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-a", { fileExplorerOpenState: { "/d": true } });
    store.updateOutlineTabState("wsi-a", "t1", { collapsedKeys: ["k1"] });
    store.copyInstanceUiState("wsi-a", "wsi-dup");

    store.updateInstanceUiState("wsi-dup", { fileExplorerOpenState: { "/d": false } });
    store.updateOutlineTabState("wsi-dup", "t1", { collapsedKeys: ["k1", "k2"] });

    const a = useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a");
    expect(a.fileExplorerOpenState).toEqual({ "/d": true });
    expect(a.outlineByTabId["t1"].collapsedKeys).toEqual(["k1"]);
  });

  it("null scroll offset is accepted (reset-to-top branch)", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-a", { fileTreeScrollOffset: 40 });
    store.updateInstanceUiState("wsi-a", { fileTreeScrollOffset: null });
    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").fileTreeScrollOffset,
    ).toBeNull();
  });

  it("copy from an unknown source is a no-op", () => {
    useWorkspaceInstanceUiStore.getState().copyInstanceUiState("wsi-ghost", "wsi-dup");
    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-dup"))
      .toEqual(DEFAULT_INSTANCE_UI_STATE);
  });

  it("re-key migrates state to the new id (ensureLooseInstance re-key)", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-old", { sidebarWidth: 220 });
    store.rekeyInstanceUiState("wsi-old", "wsi-new");

    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-new").sidebarWidth).toBe(220);
    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-old"))
      .toEqual(DEFAULT_INSTANCE_UI_STATE);
  });

  it("re-key onto an existing target keeps the target's state (no clobber)", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-old", { sidebarWidth: 220 });
    store.updateInstanceUiState("wsi-new", { sidebarWidth: 400 });
    store.rekeyInstanceUiState("wsi-old", "wsi-new");

    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-new").sidebarWidth).toBe(400);
  });

  it("remove clears state (close lifecycle); restore tolerates missing state", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-a", { sidebarWidth: 300 });
    store.removeInstanceUiState("wsi-a");

    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a"))
      .toEqual(DEFAULT_INSTANCE_UI_STATE);
  });

  it("exposes the raw map for persistence (hot-exit capture)", () => {
    const store = useWorkspaceInstanceUiStore.getState();
    store.updateInstanceUiState("wsi-a", { sidebarWidth: 260 });

    const snapshot = useWorkspaceInstanceUiStore.getState().instanceUiStates;
    expect(Object.keys(snapshot)).toEqual(["wsi-a"]);
  });

  it("hydrates from a persisted map, ignoring malformed entries", () => {
    useWorkspaceInstanceUiStore.getState().hydrateInstanceUiStates({
      "wsi-a": { ...DEFAULT_INSTANCE_UI_STATE, sidebarWidth: 200 },
      // Malformed: wrong types are dropped, not thrown.
      "wsi-bad": { sidebarWidth: "wide" } as never,
    });

    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").sidebarWidth).toBe(200);
    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-bad"))
      .toEqual(DEFAULT_INSTANCE_UI_STATE);
  });
});
