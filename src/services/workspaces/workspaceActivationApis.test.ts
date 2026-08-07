// @vitest-environment node
// WI-12.2 — ownership-aware user tab activation tests
// WI-13.1 — activation API separation (plan D6): structural store actions
// never yank the visible context; semantic switching goes through the
// coordinator; hydrate is the idempotent startup/repair path; tab activation
// resolves ownership first.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(null),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { resetContextGenerations } from "./workspaceContextGeneration";
import { hydrateWorkspaceInstanceContext } from "./hydrateWorkspaceInstanceContext";
import { activateTabWithWorkspaceContext } from "./activateTabWithWorkspaceContext";
import {
  beginWindowContextRestore,
  endWindowContextRestore,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(null);
  resetContextGenerations();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  usePaneStore.setState({ byWindow: {} });
  useWorkspaceStore.getState().closeWorkspace();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
  useWorkspacePaneLayoutsStore.getState().resetPaneLayouts();
  setRail(true);
});

describe("ensureLooseInstance is structural (WI-13.1)", () => {
  it("does NOT steal activation when a valid active instance exists", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    useWorkspaceInstancesStore.getState().ensureLooseInstance(W);

    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
  });

  it("still selects the loose instance for an empty window (structural fallback)", () => {
    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe(loose.workspaceInstanceId);
  });

  it("re-key follows identity when the OLD loose id was active, and migrates parallel state", () => {
    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    useWorkspaceInstanceUiStore.getState().updateInstanceUiState(
      loose.workspaceInstanceId, { sidebarWidth: 222 },
    );

    const rekeyed = useWorkspaceInstancesStore.getState().ensureLooseInstance(W, "wsi-loose-new");

    expect(rekeyed.workspaceInstanceId).toBe("wsi-loose-new");
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-loose-new");
    // Parallel per-instance state followed the re-key (orphan prevention).
    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-loose-new").sidebarWidth,
    ).toBe(222);
  });

  it("re-key does NOT steal activation from an unrelated active instance", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    useWorkspaceInstancesStore.getState().ensureLooseInstance(W, "wsi-loose-renamed");

    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
  });
});

describe("hydrateWorkspaceInstanceContext (WI-13.1)", () => {
  it("applies the ACTIVE instance's context without stashing, idempotently", async () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    const idA = useTabStore.getState().createTab(W, "/repo-a/one.md");

    await hydrateWorkspaceInstanceContext(W);
    expect(useWorkspaceStore.getState().rootPath).toBe("/repo-a");
    expect(useTabStore.getState().activeTabId[W]).toBe(idA);

    const before = {
      windows: useWorkspaceInstancesStore.getState().windows,
      active: useTabStore.getState().activeTabId[W],
      root: useWorkspaceStore.getState().rootPath,
    };
    await hydrateWorkspaceInstanceContext(W);
    expect(useWorkspaceInstancesStore.getState().windows).toEqual(before.windows);
    expect(useTabStore.getState().activeTabId[W]).toBe(before.active);
    expect(useWorkspaceStore.getState().rootPath).toBe(before.root);
  });

  it("is a no-op with rail off or no active instance", async () => {
    setRail(false);
    await hydrateWorkspaceInstanceContext(W);
    expect(useWorkspaceStore.getState().rootPath).toBeNull();

    setRail(true);
    await hydrateWorkspaceInstanceContext("ghost-window");
    expect(useWorkspaceStore.getState().rootPath).toBeNull();
  });
});

describe("activateTabWithWorkspaceContext (WI-13.1/12.2)", () => {
  it("activating a hidden instance's tab performs the full visible switch", () => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    useTabStore.getState().createTab(W, "/repo-a/one.md");
    const idB = useTabStore.getState().createTab(W, "/repo-b/one.md");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    const result = activateTabWithWorkspaceContext(W, idB);

    expect(result.workspaceSwitched).toBe(true);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-b");
    expect(useTabStore.getState().activeTabId[W]).toBe(idB);
    expect(useWorkspaceStore.getState().rootPath).toBe("/repo-b");
  });

  it("activating an active-instance tab does not switch", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    const id1 = useTabStore.getState().createTab(W, "/repo-a/one.md");
    useTabStore.getState().createTab(W, "/repo-a/two.md");

    const result = activateTabWithWorkspaceContext(W, id1);

    expect(result.workspaceSwitched).toBe(false);
    expect(useTabStore.getState().activeTabId[W]).toBe(id1);
  });

  it("browser tabs activate without any workspace switch (window-global)", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    const idWeb = useTabStore.getState().createBrowserTab(W, "https://example.com/");
    useTabStore.getState().createTab(W, "/repo-a/one.md");

    const result = activateTabWithWorkspaceContext(W, idWeb);

    expect(result.workspaceSwitched).toBe(false);
    expect(useTabStore.getState().activeTabId[W]).toBe(idWeb);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
  });

  it("unknown tab is a no-op", () => {
    addWorkspace("wsi-a", "/repo-a");
    const result = activateTabWithWorkspaceContext(W, "tab-ghost");
    expect(result.activated).toBe(false);
  });

  it("rail off: plain activation without ownership logic", () => {
    setRail(false);
    const id = useTabStore.getState().createTab(W, "/anywhere/one.md");
    const result = activateTabWithWorkspaceContext(W, id);
    expect(result.activated).toBe(true);
    expect(result.workspaceSwitched).toBe(false);
    expect(useTabStore.getState().activeTabId[W]).toBe(id);
  });

  it("declined switch (restore in flight) refuses the hidden-tab activation (R2-F6)", () => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    const idA = useTabStore.getState().createTab(W, "/repo-a/one.md");
    const idB = useTabStore.getState().createTab(W, "/repo-b/one.md");
    useTabStore.getState().setActiveTab(W, idA);

    beginWindowContextRestore(W);
    try {
      const result = activateTabWithWorkspaceContext(W, idB);
      expect(result).toEqual({
        activated: false,
        workspaceSwitched: false,
        workspaceInstanceId: "wsi-a",
      });
    } finally {
      endWindowContextRestore(W);
    }

    // Nothing moved: the alias still points at the visible instance's tab.
    expect(useTabStore.getState().activeTabId[W]).toBe(idA);
    expect(
      useWorkspaceInstancesStore.getState().windows[W].activeWorkspaceInstanceId,
    ).toBe("wsi-a");
  });
});
