// @vitest-environment node
/**
 * Tests for restoreInstanceVisualContext: putting an instance's stashed panes
 * and active tab back on the window. Real tab, pane, instance and pane-layout
 * stores; only Tauri is mocked.
 *
 * Covers: a missing instance is a no-op; with no stash the window shows one
 * pane on the instance's tab; a stashed split comes back whole; a stashed pane
 * whose tab now belongs to ANOTHER instance is dropped and the split collapses
 * onto the survivor; a stashed pane whose tab has closed is dropped too.
 * (`sanitizeSplitForInstance` in isolation is covered in
 * switchWorkspaceInstance.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { usePaneStore, type WindowSplit } from "@/stores/paneStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { restoreInstanceVisualContext } from "./restoreInstanceContext";

const W = "main";

function addWorkspace(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("bad test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({ workspaceInstanceId: id, root: root.root, ownerWindowLabel: W, createdFrom: "open" }),
  );
}

function openDoc(filePath: string): string {
  const id = useTabStore.getState().createTab(W, filePath);
  useDocumentStore.getState().initDocument(id, "content", filePath, { savedContent: "content" });
  return id;
}

function stash(instanceId: string, primaryTabId: string | null, secondaryTabId: string | null): void {
  const split: WindowSplit = {
    enabled: true,
    fraction: 0.3,
    primaryTabId,
    secondaryTabId,
    focusedPane: "secondary",
    syncScroll: true,
  };
  useWorkspacePaneLayoutsStore.getState().stashPaneLayout(instanceId, split);
}

const split = () => usePaneStore.getState().getSplit(W);
const activeTab = () => useTabStore.getState().activeTabId[W] ?? null;

beforeEach(() => {
  useSettingsStore.setState({ general: { ...useSettingsStore.getState().general, workspaceRailMode: true } });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  usePaneStore.setState({ byWindow: {} });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspacePaneLayoutsStore.getState().resetPaneLayouts();
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

describe("restoreInstanceVisualContext", () => {
  it("is a no-op for an instance that does not exist", () => {
    openDoc("/repo-a/one.md");
    const before = usePaneStore.getState().byWindow;

    restoreInstanceVisualContext(W, "wsi-missing");

    expect(usePaneStore.getState().byWindow).toBe(before);
  });

  it("with no stashed split, shows one pane on the instance's own tab", () => {
    openDoc("/repo-a/one.md");
    const idB = openDoc("/repo-b/one.md");

    restoreInstanceVisualContext(W, "wsi-b");

    expect(split().enabled).toBe(false);
    expect(activeTab()).toBe(idB);
  });

  it("restores a stashed split whose panes the instance still owns", () => {
    const one = openDoc("/repo-a/one.md");
    const two = openDoc("/repo-a/two.md");
    stash("wsi-a", one, two);

    restoreInstanceVisualContext(W, "wsi-a");

    expect(split()).toMatchObject({
      enabled: true,
      primaryTabId: one,
      secondaryTabId: two,
      fraction: 0.3,
      syncScroll: true,
    });
  });

  it("drops a pane whose tab now belongs to another instance and collapses onto the survivor", () => {
    const one = openDoc("/repo-a/one.md");
    const foreign = openDoc("/repo-b/one.md");
    stash("wsi-a", one, foreign);

    restoreInstanceVisualContext(W, "wsi-a");

    expect(split().enabled).toBe(false);
    expect(activeTab()).toBe(one);
  });

  it("drops a pane whose tab closed while the instance was hidden", () => {
    const one = openDoc("/repo-a/one.md");
    openDoc("/repo-a/two.md");
    // Write the stash directly so the closed-tab prune cannot clean it first.
    stash("wsi-a", one, "tab-closed-meanwhile");

    restoreInstanceVisualContext(W, "wsi-a");

    expect(split().enabled).toBe(false);
    expect(split().secondaryTabId).toBeNull();
    expect(activeTab()).toBe(one);
  });
});
