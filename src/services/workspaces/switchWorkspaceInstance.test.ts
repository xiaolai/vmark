// WI-2R — the rail-switch coordinator: stash outgoing (live ownership,
// closed projection preserved), activate, pane-aware restore of the incoming
// context, generation-guarded legacy sync. Real stores; Tauri mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(null),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { resetContextGenerations } from "./workspaceContextGeneration";
import { orderedWindowInstances } from "./workspaceContextOwnership";
import {
  sanitizeSplitForInstance,
  switchWorkspaceInstance,
} from "./switchWorkspaceInstance";

const W = "main";

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

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

/** Open a document tab with content so dirty-survival is observable. */
function openDoc(filePath: string, content = "content"): string {
  const id = useTabStore.getState().createTab(W, filePath);
  useDocumentStore.getState().initDocument(id, content, filePath, { savedContent: content });
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(null);
  resetContextGenerations();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  usePaneStore.setState({ byWindow: {} });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspacePaneLayoutsStore.getState().resetPaneLayouts();
  useClosedTabScopesStore.getState().resetClosedScopes();
  useWorkspaceStore.getState().closeWorkspace();
  setRail(true);
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

describe("switchWorkspaceInstance (WI-2R)", () => {
  it("A→B: stashes A's live tabs + focused tab, activates B, restores B's tab", () => {
    const idA1 = openDoc("/repo-a/one.md");
    const idA2 = openDoc("/repo-a/two.md");
    const idB1 = openDoc("/repo-b/one.md");
    useTabStore.getState().setActiveTab(W, idA2);

    const result = switchWorkspaceInstance(W, "wsi-b");

    expect(result.switched).toBe(true);
    const a = useWorkspaceInstancesStore.getState().instances["wsi-a"];
    expect(a.tabIds.sort()).toEqual([idA1, idA2].sort());
    expect(a.activeTabId).toBe(idA2);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-b");
    expect(useTabStore.getState().activeTabId[W]).toBe(idB1);
  });

  it("no tab or document is removed by any switch; dirty content survives A→B→A", () => {
    const idA = openDoc("/repo-a/one.md");
    openDoc("/repo-b/one.md");
    useTabStore.getState().setActiveTab(W, idA);
    useDocumentStore.getState().setContent(idA, "unsaved edits");
    expect(useDocumentStore.getState().documents[idA]?.isDirty).toBe(true);

    switchWorkspaceInstance(W, "wsi-b");
    switchWorkspaceInstance(W, "wsi-a");

    expect(useTabStore.getState().getTabsByWindow(W)).toHaveLength(2);
    const doc = useDocumentStore.getState().documents[idA];
    expect(doc?.content).toBe("unsaved edits");
    expect(doc?.isDirty).toBe(true);
    expect(useTabStore.getState().activeTabId[W]).toBe(idA);
  });

  it("same-instance click is a strict no-op", () => {
    openDoc("/repo-a/one.md");
    const before = {
      instances: useWorkspaceInstancesStore.getState().instances,
      windows: useWorkspaceInstancesStore.getState().windows,
      activeTabId: useTabStore.getState().activeTabId,
    };

    const result = switchWorkspaceInstance(W, "wsi-a");

    expect(result.switched).toBe(false);
    expect(useWorkspaceInstancesStore.getState().instances).toEqual(before.instances);
    expect(useWorkspaceInstancesStore.getState().windows).toEqual(before.windows);
    expect(useTabStore.getState().activeTabId).toEqual(before.activeTabId);
  });

  it("guards: unknown instance, other-window instance, rail off → no state change", () => {
    openDoc("/repo-a/one.md");
    const snapshot = () => ({
      windows: useWorkspaceInstancesStore.getState().windows,
      activeTabId: useTabStore.getState().activeTabId,
    });
    const before = snapshot();

    expect(switchWorkspaceInstance(W, "wsi-ghost").switched).toBe(false);
    expect(switchWorkspaceInstance("other-window", "wsi-b").switched).toBe(false);
    setRail(false);
    expect(switchWorkspaceInstance(W, "wsi-b").switched).toBe(false);

    expect(snapshot()).toEqual(before);
  });

  it("stale recorded activeTabId falls back to first owned tab; zero-tab → null", () => {
    const idA = openDoc("/repo-a/one.md");
    const idB1 = openDoc("/repo-b/one.md");
    const idB2 = openDoc("/repo-b/two.md");
    useTabStore.getState().setActiveTab(W, idA);
    // Seed B with a STALE recorded active tab.
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs(
      "wsi-b", [idB1, idB2], "tab-gone-forever",
    );

    switchWorkspaceInstance(W, "wsi-b");
    expect(useTabStore.getState().activeTabId[W]).toBe(idB1);

    // Zero-tab instance: close B's tabs, switch A → B again.
    switchWorkspaceInstance(W, "wsi-a");
    useTabStore.getState().closeTab(W, idB1);
    useTabStore.getState().closeTab(W, idB2);
    switchWorkspaceInstance(W, "wsi-b");
    expect(useTabStore.getState().activeTabId[W]).toBeNull();
  });

  it("switching never erases the scoped closed history (invariant 6)", () => {
    const idA = openDoc("/repo-a/one.md");
    openDoc("/repo-a/keep.md");
    openDoc("/repo-b/one.md");
    useTabStore.getState().closeTab(W, idA); // A's history: [idA]

    switchWorkspaceInstance(W, "wsi-b");
    switchWorkspaceInstance(W, "wsi-a");

    expect(
      useClosedTabScopesStore.getState().closedIdsForScope(W, "wsi-a"),
    ).toEqual([idA]);
    // The stashed record's closed projection matches.
    expect(
      useWorkspaceInstancesStore.getState().instances["wsi-a"].closedTabIds,
    ).toEqual([idA]);
  });

  it("stashes and restores split layouts per instance (A-split/B-single/A-restore)", () => {
    const idA1 = openDoc("/repo-a/one.md");
    const idA2 = openDoc("/repo-a/two.md");
    openDoc("/repo-b/one.md");
    useTabStore.getState().setActiveTab(W, idA1);
    usePaneStore.getState().openSplit(W, idA2);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(true);

    switchWorkspaceInstance(W, "wsi-b");
    // B has no stash → single pane.
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);

    switchWorkspaceInstance(W, "wsi-a");
    const restored = usePaneStore.getState().getSplit(W);
    expect(restored.enabled).toBe(true);
    expect(restored.primaryTabId).toBe(idA1);
    expect(restored.secondaryTabId).toBe(idA2);
    // Focused pane's tab is the alias (ADR-1).
    expect(useTabStore.getState().activeTabId[W]).toBe(
      restored.focusedPane === "primary" ? idA1 : idA2,
    );
  });

  it("legacy store re-roots synchronously with the switch", () => {
    openDoc("/repo-a/one.md");
    openDoc("/repo-b/one.md");

    switchWorkspaceInstance(W, "wsi-b");

    expect(useWorkspaceStore.getState().rootPath).toBe("/repo-b");
  });

  it("rapid A→B→A: terminal state equals a completed round trip (idempotency)", async () => {
    const idA = openDoc("/repo-a/one.md");
    const idB = openDoc("/repo-b/one.md");
    useTabStore.getState().setActiveTab(W, idA);

    const r1 = switchWorkspaceInstance(W, "wsi-b");
    const r2 = switchWorkspaceInstance(W, "wsi-a");
    await Promise.all([r1.refresh, r2.refresh]);

    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
    expect(useTabStore.getState().activeTabId[W]).toBe(idA);
    expect(useWorkspaceStore.getState().rootPath).toBe("/repo-a");
    expect(useWorkspaceInstancesStore.getState().instances["wsi-b"].tabIds).toEqual([idB]);
  });

  it("loose round trip: out-of-workspace tab is only active under loose", () => {
    const idLoose = openDoc("/elsewhere/notes.md");
    const idA = openDoc("/repo-a/one.md");
    useTabStore.getState().setActiveTab(W, idA);
    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    // ensureLooseInstance activates as a side effect today — restore A.
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    switchWorkspaceInstance(W, loose.workspaceInstanceId);
    expect(useTabStore.getState().activeTabId[W]).toBe(idLoose);

    switchWorkspaceInstance(W, "wsi-a");
    expect(useTabStore.getState().activeTabId[W]).toBe(idA);
    expect(useTabStore.getState().getTabsByWindow(W)).toHaveLength(2);
  });
});

describe("sanitizeSplitForInstance (audit R2-F3)", () => {
  it("nulls pane ids the instance does not own; owned panes survive", () => {
    const idA = openDoc("/repo-a/one.md");
    const idB = openDoc("/repo-b/one.md");
    const split = {
      enabled: true,
      orientation: "horizontal" as const,
      fraction: 0.5,
      primaryTabId: idA,
      secondaryTabId: idB, // owned by wsi-b — must not restore into wsi-a
      focusedPane: "primary" as const,
      syncScroll: false,
    };

    const sane = sanitizeSplitForInstance(
      split, "wsi-a", useTabStore.getState().getTabsByWindow(W), orderedWindowInstances(W),
    );

    expect(sane?.primaryTabId).toBe(idA);
    expect(sane?.secondaryTabId).toBeNull();
  });

  it("passes disabled splits and null through untouched", () => {
    expect(sanitizeSplitForInstance(null, "wsi-a", [], [])).toBeNull();
    const single = {
      enabled: false,
      orientation: "horizontal" as const,
      fraction: 0.5,
      primaryTabId: "t-stale",
      secondaryTabId: null,
      focusedPane: "primary" as const,
      syncScroll: false,
    };
    expect(sanitizeSplitForInstance(single, "wsi-a", [], [])).toBe(single);
  });
});
