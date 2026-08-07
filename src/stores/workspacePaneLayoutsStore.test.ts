// @vitest-environment node
// WI-10.2 — per-instance pane snapshots: hidden workspaces' split layouts,
// stashed on switch-out and restored (validated) on switch-in. Pruned when a
// hidden pane tab closes; full copy/re-key/remove lifecycle.
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SPLIT, type WindowSplit } from "./paneStore";
import { notifyTabRemoved } from "./tabRemovalBus";
import { useWorkspacePaneLayoutsStore } from "./workspacePaneLayoutsStore";

const SPLIT: WindowSplit = {
  ...DEFAULT_SPLIT,
  enabled: true,
  primaryTabId: "t-1",
  secondaryTabId: "t-2",
  focusedPane: "secondary",
  fraction: 0.4,
};

beforeEach(() => {
  useWorkspacePaneLayoutsStore.getState().resetPaneLayouts();
});

describe("workspacePaneLayoutsStore", () => {
  it("stashes and reads back a layout per instance", () => {
    useWorkspacePaneLayoutsStore.getState().stashPaneLayout("wsi-a", SPLIT);
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-a")).toEqual(SPLIT);
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-b")).toBeNull();
  });

  it("stashing a disabled split stores null (nothing to restore)", () => {
    useWorkspacePaneLayoutsStore.getState().stashPaneLayout("wsi-a", SPLIT);
    useWorkspacePaneLayoutsStore.getState().stashPaneLayout("wsi-a", DEFAULT_SPLIT);
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-a")).toBeNull();
  });

  it("closing a hidden pane tab prunes the stashed layout immediately", () => {
    useWorkspacePaneLayoutsStore.getState().stashPaneLayout("wsi-a", SPLIT);

    notifyTabRemoved("main", "t-2");

    // The layout survives but the dead pane is nulled — restore-time
    // validation (WI-10.1) would collapse it to the surviving tab.
    const pruned = useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-a");
    expect(pruned?.secondaryTabId).toBeNull();
    expect(pruned?.primaryTabId).toBe("t-1");
  });

  it("closing BOTH pane tabs drops the stash entirely", () => {
    useWorkspacePaneLayoutsStore.getState().stashPaneLayout("wsi-a", SPLIT);
    notifyTabRemoved("main", "t-1");
    notifyTabRemoved("main", "t-2");
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-a")).toBeNull();
  });

  it("copy duplicates a layout; re-key migrates it; remove clears it", () => {
    const store = useWorkspacePaneLayoutsStore.getState();
    store.stashPaneLayout("wsi-a", SPLIT);

    store.copyPaneLayout("wsi-a", "wsi-dup");
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-dup")).toEqual(SPLIT);

    store.rekeyPaneLayout("wsi-a", "wsi-new");
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-a")).toBeNull();
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-new")).toEqual(SPLIT);

    store.removePaneLayout("wsi-new");
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-new")).toBeNull();
  });

  it("copy from unknown source and remove of unknown id are no-ops", () => {
    const store = useWorkspacePaneLayoutsStore.getState();
    expect(() => store.copyPaneLayout("ghost", "wsi-x")).not.toThrow();
    expect(() => store.removePaneLayout("ghost")).not.toThrow();
    expect(useWorkspacePaneLayoutsStore.getState().getPaneLayout("wsi-x")).toBeNull();
  });
});
