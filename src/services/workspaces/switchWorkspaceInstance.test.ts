// @vitest-environment node
// WI-2R — the rail-switch coordinator: stash outgoing (live ownership,
// closed projection preserved), activate, pane-aware restore of the incoming
// context, generation-guarded legacy sync. Real stores; Tauri mocked.
// WI-TS2.2 — terminal scope wiring: adoption into the outgoing instance,
// visible-set swap on switch, and hydrate's convergent realign (D-T12).
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
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import { hydrateWorkspaceInstanceContext } from "./hydrateWorkspaceInstanceContext";
import { sanitizeSplitForInstance } from "./restoreInstanceContext";
import { switchWorkspaceInstance } from "./switchWorkspaceInstance";

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
  resetTerminalSessionStore();
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
    useDocumentStore.getState().setEditorContent(idA, "unsaved edits");
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

describe("terminal scope wiring (WI-TS2.2)", () => {
  const term = () => useUIStore.getState().terminal;
  const createTerm = (owner?: string) =>
    useUIStore
      .getState()
      .terminalCreateSession(owner ? { ownerInstanceId: owner } : undefined)!;

  it("A→B hides A's set: active swaps, membership UNCHANGED (invariant 1)", () => {
    const sa = createTerm("wsi-a");
    const sb = createTerm("wsi-b");
    useUIStore.getState().terminalSetActiveSession(sa.id);

    switchWorkspaceInstance(W, "wsi-b");
    expect(term().sessions.map((s) => s.id).sort()).toEqual([sa.id, sb.id].sort());
    expect(term().activeSessionId).toBe(sb.id);

    switchWorkspaceInstance(W, "wsi-a");
    expect(term().activeSessionId).toBe(sa.id);
    expect(term().sessions).toHaveLength(2);
  });

  it("adopts window-scoped sessions into the OUTGOING instance", () => {
    const su = createTerm(); // created under wsi-a's watch, unscoped

    switchWorkspaceInstance(W, "wsi-b");

    expect(term().sessions.find((s) => s.id === su.id)?.workspaceInstanceId).toBe(
      "wsi-a",
    );
    // …and it is therefore hidden in B: nothing to show.
    expect(term().activeSessionId).toBeNull();
  });

  it("hydrate adopts into the final active instance and activates (no double-create)", async () => {
    const su = createTerm(); // restore carve-out: unscoped

    await hydrateWorkspaceInstanceContext(W); // active is wsi-a

    expect(term().sessions).toHaveLength(1);
    expect(term().sessions[0]?.workspaceInstanceId).toBe("wsi-a");
    expect(term().activeSessionId).toBe(su.id);
  });

  it("user-switch-then-hydrate converges — hydrate cannot clobber the switch (D-T12)", async () => {
    const su = createTerm(); // unscoped, created pre-switch
    switchWorkspaceInstance(W, "wsi-b"); // user switch adopts into wsi-a

    await hydrateWorkspaceInstanceContext(W); // re-derives from wsi-b

    expect(term().sessions.find((s) => s.id === su.id)?.workspaceInstanceId).toBe(
      "wsi-a",
    );
    expect(term().activeSessionId).toBeNull(); // still B's (empty) view
  });
});
