// @vitest-environment node
// WI-11.2 — context-aware reopen: A/B partition, window-global browser
// interleave by close sequence, duplicate-path skip, empty histories; and a
// reopened document gets its content back (read from disk, or empty when it
// never had a file).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileBytes } from "@/test/fileBytes";

const diskText = vi.fn<(path: string) => unknown>((path) => `# ${path}`);
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (path: string) => fileBytes(diskText(path)),
}));
vi.mock("@tauri-apps/api/core", () => ({
  // Size probes answer "small"; the recents menu/dock updates are no-ops.
  invoke: (cmd: string) =>
    Promise.resolve(cmd === "get_file_size_bytes" || cmd === "count_markdown_blocks" ? 1 : undefined),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";
import { rebootstrapFormats } from "@/lib/formats/registryBootstrap";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { WINDOW_ALL_SCOPE, useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
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
  vi.clearAllMocks();
  diskText.mockImplementation((path) => `# ${path}`);
  rebootstrapFormats();
  for (const id of Object.keys(useDocumentStore.getState().documents)) {
    useDocumentStore.getState().removeDocument(id);
  }
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useClosedTabScopesStore.getState().resetClosedScopes();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  setRail(false);
});

describe("reopenClosedTabForActiveContext (WI-11.2, rail on)", () => {
  it("reopens only the ACTIVE instance's history (A/B partition)", async () => {
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
    const reopened = await reopenClosedTabForActiveContext(W);
    expect(reopened?.id).toBe(idA);
    // B's history is untouched.
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope(W, "wsi-b"),
    ).toEqual([idB]);
  });

  it("browser history is window-global and interleaves by close sequence", async () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    const idDoc = useTabStore.getState().createTab(W, "/repo-a/a.md");
    const idWeb = useTabStore.getState().createBrowserTab(W, "https://example.com/");
    useTabStore.getState().closeTab(W, idDoc);
    useTabStore.getState().closeTab(W, idWeb); // newest

    const first = await reopenClosedTabForActiveContext(W);
    expect(first?.id).toBe(idWeb);
    const second = await reopenClosedTabForActiveContext(W);
    expect(second?.id).toBe(idDoc);
  });

  it("skips a closed document whose path is already open (no duplicate, no steal)", async () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    const idOld = useTabStore.getState().createTab(W, "/repo-a/a.md");
    const idOther = useTabStore.getState().createTab(W, "/repo-a/other.md");
    useTabStore.getState().closeTab(W, idOther);
    useTabStore.getState().closeTab(W, idOld);
    // Reopen the same path via a NEW tab — the closed entry is now a duplicate.
    useTabStore.getState().createTab(W, "/repo-a/a.md");

    const reopened = await reopenClosedTabForActiveContext(W);
    // The duplicate entry was skipped; the next candidate reopened instead.
    expect(reopened?.id).toBe(idOther);
    expect(
      useTabStore.getState().getTabsByWindow(W).filter(
        (t) => t.kind === "document" && t.filePath === "/repo-a/a.md",
      ),
    ).toHaveLength(1);
  });

  it("rail on with no active instance still reopens window-all/browser history", async () => {
    setRail(true);
    // No instances registered at all → candidate scopes fall back.
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    const id = useTabStore.getState().createTab(W, "/loose/x.md");
    useTabStore.getState().closeTab(W, id);

    expect((await reopenClosedTabForActiveContext(W))?.id).toBe(id);
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

    const reopened = await reopenClosedTabForActiveContext(W);
    expect(reopened?.kind).toBe("browser");
    // Browser tabs never land in a pane; the alias points at the browser tab.
    expect(usePaneStore.getState().getSplit(W).secondaryTabId).toBe(d2);
    expect(useTabStore.getState().activeTabId[W]).toBe(reopened?.id);
  });

  it("returns null when the active context and browser histories are empty", async () => {
    setRail(true);
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    const idB = useTabStore.getState().createTab(W, "/repo-b/b.md");
    useTabStore.getState().closeTab(W, idB);
    // Hidden B has history; active A does not → nothing reopens for A.
    expect(await reopenClosedTabForActiveContext(W)).toBeNull();
  });
});

describe("reopenClosedTabForActiveContext — the reopened document's content", () => {
  it("reads a closed file back from disk into the SAME tab, clean", async () => {
    const id = useTabStore.getState().createTab(W, "/notes/a.md");
    useDocumentStore.getState().initDocument(id, "stale", "/notes/a.md");
    useTabStore.getState().closeTab(W, id);
    // Close freed the document (the tab-removal bus does this in the app).
    useDocumentStore.getState().removeDocument(id);
    diskText.mockReturnValue("# On disk now");

    const reopened = await reopenClosedTabForActiveContext(W);

    expect(reopened?.id).toBe(id);
    expect(useTabStore.getState().activeTabId[W]).toBe(id);
    const doc = useDocumentStore.getState().getDocument(id);
    expect(doc?.content).toBe("# On disk now");
    expect(doc?.filePath).toBe("/notes/a.md");
    expect(doc?.isDirty).toBe(false);
  });

  it("opens a closed untitled tab as an empty document (its edits were not kept)", async () => {
    const id = useTabStore.getState().createTab(W, null);
    useDocumentStore.getState().initDocument(id, "unsaved words", null);
    useTabStore.getState().closeTab(W, id);
    useDocumentStore.getState().removeDocument(id);

    const reopened = await reopenClosedTabForActiveContext(W);

    expect(reopened?.id).toBe(id);
    expect(diskText).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().getDocument(id)?.content).toBe("");
  });

  it("removes the tab again and says so when the file can no longer be read", async () => {
    const id = useTabStore.getState().createTab(W, "/gone/a.md");
    useTabStore.getState().closeTab(W, id);
    diskText.mockReturnValue(Promise.reject(new Error("ENOENT")));

    await expect(reopenClosedTabForActiveContext(W)).resolves.toBeNull();

    expect(useTabStore.getState().findTabById(id)).toBeNull();
    expect(useDocumentStore.getState().getDocument(id)).toBeUndefined();
    expect(toast.error).toHaveBeenCalled();
    // A failed reopen is not a close: it must not re-enter the history.
    expect(useClosedTabScopesStore.getState().newestEntry(W, [WINDOW_ALL_SCOPE])).toBeNull();
  });
});
