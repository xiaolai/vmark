// WI-13.4 — ownership reassignment on deliberate navigation (Save As, rename,
// cross-root move): atomic reclassification; the visible context follows ONLY
// when the ACTIVE tab's owner changed and the caller allows it (MCP does not).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(null),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { resetContextGenerations } from "./workspaceContextGeneration";
import { reassignTabOwnershipForPath } from "./reassignTabOwnershipForPath";

const W = "main";

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

beforeEach(() => {
  vi.clearAllMocks();
  resetContextGenerations();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useWorkspaceStore.getState().closeWorkspace();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
  });
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

describe("reassignTabOwnershipForPath (WI-13.4)", () => {
  it("Save As into another root: ACTIVE tab reassigns and the context follows", () => {
    const id = useTabStore.getState().createTab(W, "/repo-a/draft.md");
    useTabStore.getState().setActiveTab(W, id);
    useTabStore.getState().updateTabPath(id, "/repo-b/final.md");

    const result = reassignTabOwnershipForPath(W, id, "/repo-b/final.md");

    expect(result.workspaceSwitched).toBe(true);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-b");
    expect(
      useWorkspaceInstancesStore.getState().instances["wsi-b"].tabIds,
    ).toContain(id);
    expect(useTabStore.getState().activeTabId[W]).toBe(id);
  });

  it("BACKGROUND tab reassigns without any visible switch", () => {
    const idActive = useTabStore.getState().createTab(W, "/repo-a/one.md");
    const idBg = useTabStore.getState().createTab(W, "/repo-a/two.md");
    useTabStore.getState().setActiveTab(W, idActive);
    useTabStore.getState().updateTabPath(idBg, "/repo-b/moved.md");

    const result = reassignTabOwnershipForPath(W, idBg, "/repo-b/moved.md");

    expect(result.workspaceSwitched).toBe(false);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
    expect(
      useWorkspaceInstancesStore.getState().instances["wsi-b"].tabIds,
    ).toContain(idBg);
  });

  it("rename within the same root: no switch, ownership unchanged", () => {
    const id = useTabStore.getState().createTab(W, "/repo-a/old.md");
    useTabStore.getState().setActiveTab(W, id);
    useTabStore.getState().updateTabPath(id, "/repo-a/new.md");

    const result = reassignTabOwnershipForPath(W, id, "/repo-a/new.md");

    expect(result.workspaceSwitched).toBe(false);
    expect(
      useWorkspaceInstancesStore.getState().instances["wsi-a"].tabIds,
    ).toContain(id);
  });

  it("move out of every root: reassigns to loose and follows when active", () => {
    const id = useTabStore.getState().createTab(W, "/repo-a/doc.md");
    useTabStore.getState().setActiveTab(W, id);
    useTabStore.getState().updateTabPath(id, "/elsewhere/doc.md");

    const result = reassignTabOwnershipForPath(W, id, "/elsewhere/doc.md");

    expect(result.workspaceSwitched).toBe(true);
    const state = useWorkspaceInstancesStore.getState();
    const activeId = state.windows[W].activeWorkspaceInstanceId!;
    expect(state.instances[activeId]?.kind).toBe("loose");
    expect(state.instances[activeId]?.tabIds).toContain(id);
  });

  it("allowVisibleSwitch:false (MCP, D10): reassigns but never yanks", () => {
    const id = useTabStore.getState().createTab(W, "/repo-a/draft.md");
    useTabStore.getState().setActiveTab(W, id);
    useTabStore.getState().updateTabPath(id, "/repo-b/final.md");

    const result = reassignTabOwnershipForPath(W, id, "/repo-b/final.md", {
      allowVisibleSwitch: false,
    });

    expect(result.workspaceSwitched).toBe(false);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
    expect(
      useWorkspaceInstancesStore.getState().instances["wsi-b"].tabIds,
    ).toContain(id);
  });

  it("post-switch activation is PANE-AWARE when the incoming context has a split", async () => {
    const { usePaneStore } = await import("@/stores/paneStore");
    const { useWorkspacePaneLayoutsStore } = await import("@/stores/workspacePaneLayoutsStore");
    // B has two docs and a stashed split.
    const b1 = useTabStore.getState().createTab(W, "/repo-b/one.md");
    const b2 = useTabStore.getState().createTab(W, "/repo-b/two.md");
    useWorkspaceInstancesStore.getState().setWorkspaceInstanceTabs("wsi-b", [b1, b2], b1);
    useWorkspacePaneLayoutsStore.getState().stashPaneLayout("wsi-b", {
      enabled: true, orientation: "horizontal", fraction: 0.5,
      primaryTabId: b1, secondaryTabId: b2, focusedPane: "primary", syncScroll: false,
    });
    // Active doc in A gets Saved-As into B.
    const id = useTabStore.getState().createTab(W, "/repo-a/draft.md");
    useTabStore.getState().setActiveTab(W, id);
    useTabStore.getState().updateTabPath(id, "/repo-b/final.md");

    const result = reassignTabOwnershipForPath(W, id, "/repo-b/final.md");

    expect(result.workspaceSwitched).toBe(true);
    // The split was restored for B; the reassigned tab landed in the focused
    // pane (single alias writer) — not via a raw setActiveTab.
    const split = usePaneStore.getState().getSplit(W);
    expect(split.enabled).toBe(true);
    const focusedTab = split.focusedPane === "primary" ? split.primaryTabId : split.secondaryTabId;
    expect(focusedTab).toBe(id);
    expect(useTabStore.getState().activeTabId[W]).toBe(id);
  });

  it("rail off: complete no-op", () => {
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: false },
    });
    const id = useTabStore.getState().createTab(W, "/repo-a/doc.md");

    const result = reassignTabOwnershipForPath(W, id, "/repo-b/doc.md");

    expect(result.workspaceSwitched).toBe(false);
  });

  it("unknown tab id: path still classifies, but the visible context never moves", () => {
    const result = reassignTabOwnershipForPath(W, "tab-ghost", "/repo-b/x.md");
    expect(result.workspaceSwitched).toBe(false);
    expect(result.workspaceInstanceId).toBe("wsi-b");
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
  });

  it("declined switch (restore in flight): ownership moves, context does not", async () => {
    const { beginWindowContextRestore, endWindowContextRestore } = await import(
      "./switchWorkspaceInstance"
    );
    const id = useTabStore.getState().createTab(W, "/repo-a/draft.md");
    useTabStore.getState().setActiveTab(W, id);
    useTabStore.getState().updateTabPath(id, "/repo-b/final.md");

    beginWindowContextRestore(W);
    try {
      const result = reassignTabOwnershipForPath(W, id, "/repo-b/final.md");
      expect(result.workspaceSwitched).toBe(false);
    } finally {
      endWindowContextRestore(W);
    }

    expect(
      useWorkspaceInstancesStore.getState().instances["wsi-b"].tabIds,
    ).toContain(id);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
  });

  it("MCP no-switch under a SPLIT re-coheres via the focused pane (R2-F7)", async () => {
    const { usePaneStore } = await import("@/stores/paneStore");
    const idKeep = useTabStore.getState().createTab(W, "/repo-a/keep.md");
    const idMove = useTabStore.getState().createTab(W, "/repo-a/move.md");
    useTabStore.getState().setActiveTab(W, idKeep);
    usePaneStore.getState().openSplit(W, idMove);
    // The focused pane's tab is the alias — that's the one we move away.
    const activeNow = useTabStore.getState().activeTabId[W]!;
    useTabStore.getState().updateTabPath(activeNow, "/repo-b/moved.md");

    const result = reassignTabOwnershipForPath(W, activeNow, "/repo-b/moved.md", {
      allowVisibleSwitch: false,
    });

    expect(result.workspaceSwitched).toBe(false);
    // Alias re-cohered to wsi-a's remaining tab, written through the pane.
    const remaining = activeNow === idKeep ? idMove : idKeep;
    expect(useTabStore.getState().activeTabId[W]).toBe(remaining);
    const split = usePaneStore.getState().getSplit(W);
    const focusedTab =
      split.focusedPane === "primary" ? split.primaryTabId : split.secondaryTabId;
    expect(focusedTab).toBe(remaining);
  });
});
