// WI-7R — cross-feature regression: the switch coordinator's stashing must
// not break close, move/duplicate collection, or hot-exit capture, and the
// exclusive-ownership + browser-exclusion invariants must hold after
// arbitrary switch sequences.
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
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { resetContextGenerations } from "./workspaceContextGeneration";
import { switchWorkspaceInstance } from "./switchWorkspaceInstance";
import { closeWorkspaceInstance } from "./closeWorkspaceInstance";
import { collectWorkspaceTabs } from "./workspaceTabCollection";
import { captureWindowWorkspaceInstances } from "@/services/persistence/hotExit/workspaceInstances";

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

function openDoc(filePath: string): string {
  const id = useTabStore.getState().createTab(W, filePath);
  useDocumentStore.getState().initDocument(id, "content", filePath, { savedContent: "content" });
  return id;
}

/** Union of all instances' tabIds must contain no cross-instance duplicates. */
function assertExclusiveOwnership(): void {
  const seen = new Map<string, string>();
  for (const instance of Object.values(useWorkspaceInstancesStore.getState().instances)) {
    for (const tabId of instance.tabIds) {
      const previous = seen.get(tabId);
      expect(
        previous,
        `tab ${tabId} claimed by both ${previous} and ${instance.workspaceInstanceId}`,
      ).toBeUndefined();
      seen.set(tabId, instance.workspaceInstanceId);
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(null);
  resetContextGenerations();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  usePaneStore.setState({ byWindow: {} });
  useWorkspaceStore.getState().closeWorkspace();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
  useWorkspacePaneLayoutsStore.getState().resetPaneLayouts();
  useClosedTabScopesStore.getState().resetClosedScopes();
  setRail(true);
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

describe("workspaceSwitchInterplay (WI-7R)", () => {
  it("switch×N then close A: exactly A's tabs close; parallel state cleaned", async () => {
    const idA = openDoc("/repo-a/one.md");
    const idB = openDoc("/repo-b/one.md");
    const idLoose = openDoc("/elsewhere/x.md");
    useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    useWorkspaceInstanceUiStore.getState().updateInstanceUiState("wsi-a", { sidebarWidth: 200 });

    switchWorkspaceInstance(W, "wsi-b");
    switchWorkspaceInstance(W, "wsi-a");
    switchWorkspaceInstance(W, "wsi-b");

    const closed: string[] = [];
    const result = await closeWorkspaceInstance(W, "wsi-a", {
      closeTabs: async (windowLabel, tabIds) => {
        for (const id of tabIds) {
          closed.push(id);
          useTabStore.getState().closeTab(windowLabel, id);
        }
        return true;
      },
    });

    expect(result.ok).toBe(true);
    expect(closed).toEqual([idA]);
    const remaining = useTabStore.getState().getTabsByWindow(W).map((t) => t.id);
    expect(remaining.sort()).toEqual([idB, idLoose].sort());
    expect(useWorkspaceInstancesStore.getState().instances["wsi-a"]).toBeUndefined();
    // Parallel per-instance state cleaned (WI-9.1 lifecycle).
    expect(useWorkspaceInstanceUiStore.getState().instanceUiStates["wsi-a"]).toBeUndefined();
    assertExclusiveOwnership();
  });

  it("switch×N then collect B for a move: exactly B's owned document tabs", () => {
    openDoc("/repo-a/one.md");
    const idB1 = openDoc("/repo-b/one.md");
    const idB2 = openDoc("/repo-b/two.md");
    useTabStore.getState().createBrowserTab(W, "https://example.com/");

    switchWorkspaceInstance(W, "wsi-b");
    switchWorkspaceInstance(W, "wsi-a");

    const instance = useWorkspaceInstancesStore.getState().instances["wsi-b"];
    const collected = collectWorkspaceTabs(W, instance, "move");

    expect(collected.tabs.map((t) => t.tabId).sort()).toEqual([idB1, idB2].sort());
  });

  it("hot-exit capture after switches serializes correct per-instance tabs, no browser ids", () => {
    const idA = openDoc("/repo-a/one.md");
    const idB = openDoc("/repo-b/one.md");
    const webId = useTabStore.getState().createBrowserTab(W, "https://example.com/");
    useTabStore.getState().setActiveTab(W, idA);

    switchWorkspaceInstance(W, "wsi-b");
    switchWorkspaceInstance(W, "wsi-a");

    const captured = captureWindowWorkspaceInstances(W);
    const a = captured.workspace_instances.find((i) => i.workspaceInstanceId === "wsi-a")!;
    const b = captured.workspace_instances.find((i) => i.workspaceInstanceId === "wsi-b")!;

    expect(a.tabIds).toEqual([idA]);
    expect(b.tabIds).toEqual([idB]);
    expect(captured.active_workspace_instance_id).toBe("wsi-a");
    for (const instance of captured.workspace_instances) {
      expect(instance.tabIds).not.toContain(webId);
      expect(instance.closedTabIds).not.toContain(webId);
    }
  });

  it("exclusivity invariant holds across arbitrary switch orderings", () => {
    openDoc("/repo-a/one.md");
    openDoc("/repo-a/two.md");
    openDoc("/repo-b/one.md");
    openDoc("/elsewhere/x.md");
    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance(W);

    const orderings = [
      ["wsi-b", "wsi-a", loose.workspaceInstanceId, "wsi-b"],
      [loose.workspaceInstanceId, "wsi-b", "wsi-a"],
      ["wsi-b", loose.workspaceInstanceId, "wsi-a", "wsi-b", "wsi-a"],
    ];
    for (const order of orderings) {
      for (const target of order) {
        switchWorkspaceInstance(W, target);
        assertExclusiveOwnership();
      }
    }
  });

  it("switch after close targets the surviving instances cleanly", async () => {
    openDoc("/repo-a/one.md");
    const idB = openDoc("/repo-b/one.md");
    switchWorkspaceInstance(W, "wsi-b");

    await closeWorkspaceInstance(W, "wsi-a", {
      closeTabs: async (windowLabel, tabIds) => {
        for (const id of tabIds) useTabStore.getState().closeTab(windowLabel, id);
        return true;
      },
    });

    // A is gone; switching to B (already active) declines; the surviving
    // context stays coherent.
    expect(switchWorkspaceInstance(W, "wsi-a").switched).toBe(false);
    expect(useTabStore.getState().getTabsByWindow(W).map((t) => t.id)).toEqual([idB]);
    assertExclusiveOwnership();
  });
});
