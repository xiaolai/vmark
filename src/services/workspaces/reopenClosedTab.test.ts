// @vitest-environment node
// WI-11.2 — context-aware reopen: A/B partition, window-global browser
// interleave by close sequence, duplicate-path skip, empty histories.
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { reopenClosedTabForActiveContext } from "./reopenClosedTab";

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

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useClosedTabScopesStore.getState().resetClosedScopes();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  setRail(false);
});

describe("reopenClosedTabForActiveContext (WI-11.2, rail on)", () => {
  it("reopens only the ACTIVE instance's history (A/B partition)", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    // Close order: A-doc first, then B-doc (B is newest overall).
    const idA = useTabStore.getState().createTab(W, "/repo-a/a.md");
    const idB = useTabStore.getState().createTab(W, "/repo-b/b.md");
    useTabStore.getState().closeTab(W, idA);
    useTabStore.getState().closeTab(W, idB);

    // A is active → A's entry reopens even though B's is newer.
    const reopened = reopenClosedTabForActiveContext(W);
    expect(reopened?.id).toBe(idA);
    // B's history is untouched.
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope(W, "wsi-b"),
    ).toEqual([idB]);
  });

  it("browser history is window-global and interleaves by close sequence", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    const idDoc = useTabStore.getState().createTab(W, "/repo-a/a.md");
    const idWeb = useTabStore.getState().createBrowserTab(W, "https://example.com/");
    useTabStore.getState().closeTab(W, idDoc);
    useTabStore.getState().closeTab(W, idWeb); // newest

    const first = reopenClosedTabForActiveContext(W);
    expect(first?.id).toBe(idWeb);
    const second = reopenClosedTabForActiveContext(W);
    expect(second?.id).toBe(idDoc);
  });

  it("skips a closed document whose path is already open (no duplicate, no steal)", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    const idOld = useTabStore.getState().createTab(W, "/repo-a/a.md");
    const idOther = useTabStore.getState().createTab(W, "/repo-a/other.md");
    useTabStore.getState().closeTab(W, idOther);
    useTabStore.getState().closeTab(W, idOld);
    // Reopen the same path via a NEW tab — the closed entry is now a duplicate.
    useTabStore.getState().createTab(W, "/repo-a/a.md");

    const reopened = reopenClosedTabForActiveContext(W);
    // The duplicate entry was skipped; the next candidate reopened instead.
    expect(reopened?.id).toBe(idOther);
    expect(
      useTabStore.getState().getTabsByWindow(W).filter(
        (t) => t.kind === "document" && t.filePath === "/repo-a/a.md",
      ),
    ).toHaveLength(1);
  });

  it("rail on with no active instance still reopens window-all/browser history", () => {
    setRail(true);
    // No instances registered at all → candidate scopes fall back.
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    const id = useTabStore.getState().createTab(W, "/loose/x.md");
    useTabStore.getState().closeTab(W, id);

    expect(reopenClosedTabForActiveContext(W)?.id).toBe(id);
  });

  it("a browser tab reopens via plain activation even while a split is enabled", async () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    const d1 = useTabStore.getState().createTab(W, "/repo-a/1.md");
    const d2 = useTabStore.getState().createTab(W, "/repo-a/2.md");
    const web = useTabStore.getState().createBrowserTab(W, "https://x.example/");
    useTabStore.getState().closeTab(W, web);
    const { usePaneStore } = await import("@/stores/paneStore");
    useTabStore.getState().setActiveTab(W, d1);
    usePaneStore.getState().openSplit(W, d2);

    const reopened = reopenClosedTabForActiveContext(W);
    expect(reopened?.kind).toBe("browser");
    // Browser tabs never land in a pane; the alias points at the browser tab.
    expect(usePaneStore.getState().getSplit(W).secondaryTabId).toBe(d2);
    expect(useTabStore.getState().activeTabId[W]).toBe(reopened?.id);
  });

  it("returns null when the active context and browser histories are empty", () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    const idB = useTabStore.getState().createTab(W, "/repo-b/b.md");
    useTabStore.getState().closeTab(W, idB);
    // Hidden B has history; active A does not → nothing reopens for A.
    expect(reopenClosedTabForActiveContext(W)).toBeNull();
  });
});
