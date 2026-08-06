// WI-4R — visible tab strip/cycling projection tests
// WI-12.1 — active-instance listing projection tests
// WI-8.1/4R — the visible-tab projection: active-instance documents + ALL
// browser tabs; rail-off parity; swaps with the coordinator switch.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { resetContextGenerations } from "@/services/workspaces/workspaceContextGeneration";
import { switchWorkspaceInstance } from "@/services/workspaces/switchWorkspaceInstance";
import { useVisibleWindowTabs } from "./useVisibleWindowTabs";
import { visibleWindowTabs, allWindowTabs } from "@/services/tabs/visibleWindowTabs";

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
  resetContextGenerations();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  usePaneStore.setState({ byWindow: {} });
  useWorkspaceStore.getState().closeWorkspace();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspacePaneLayoutsStore.getState().resetPaneLayouts();
  setRail(true);
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

describe("useVisibleWindowTabs (WI-8.1/4R)", () => {
  it("shows active-instance documents plus ALL browser tabs", () => {
    const idA = useTabStore.getState().createTab(W, "/repo-a/one.md");
    useTabStore.getState().createTab(W, "/repo-b/one.md");
    const idWeb = useTabStore.getState().createBrowserTab(W, "https://example.com/");

    const { result } = renderHook(() => useVisibleWindowTabs(W));

    expect(result.current.map((t) => t.id)).toEqual([idA, idWeb]);
  });

  it("swaps with the coordinator switch (rerender shows the other set)", () => {
    useTabStore.getState().createTab(W, "/repo-a/one.md");
    const idB = useTabStore.getState().createTab(W, "/repo-b/one.md");
    const idWeb = useTabStore.getState().createBrowserTab(W, "https://example.com/");

    const { result, rerender } = renderHook(() => useVisibleWindowTabs(W));
    switchWorkspaceInstance(W, "wsi-b");
    rerender();

    expect(result.current.map((t) => t.id)).toEqual([idB, idWeb]);
  });

  it("rail off: deep-equals the raw window list (parity)", () => {
    setRail(false);
    useTabStore.getState().createTab(W, "/repo-a/one.md");
    useTabStore.getState().createTab(W, "/anywhere/x.md");

    const { result } = renderHook(() => useVisibleWindowTabs(W));

    expect(result.current).toEqual(useTabStore.getState().tabs[W]);
  });

  it("imperative and reactive projections agree; allWindowTabs sees everything", () => {
    useTabStore.getState().createTab(W, "/repo-a/one.md");
    useTabStore.getState().createTab(W, "/repo-b/one.md");

    const { result } = renderHook(() => useVisibleWindowTabs(W));

    expect(visibleWindowTabs(W).map((t) => t.id)).toEqual(result.current.map((t) => t.id));
    expect(allWindowTabs(W)).toHaveLength(2);
    expect(result.current).toHaveLength(1);
  });

  it("unknown window: every projection returns empty, never throws", () => {
    expect(visibleWindowTabs("ghost")).toEqual([]);
    expect(allWindowTabs("ghost")).toEqual([]);
    const { result } = renderHook(() => useVisibleWindowTabs("ghost"));
    expect(result.current).toEqual([]);
  });

  it("tolerates partial store shapes (pre-init settings, mock without tabs)", () => {
    const savedGeneral = useSettingsStore.getState().general;
    const savedTabs = useTabStore.getState().tabs;
    useSettingsStore.setState({ general: undefined as never });
    useTabStore.setState({ tabs: undefined as never });
    try {
      expect(visibleWindowTabs(W)).toEqual([]);
      expect(allWindowTabs(W)).toEqual([]);
      const { result } = renderHook(() => useVisibleWindowTabs(W));
      expect(result.current).toEqual([]);
    } finally {
      useSettingsStore.setState({ general: savedGeneral });
      useTabStore.setState({ tabs: savedTabs });
    }
  });

  it("window record lacking instanceIds still shows browser tabs (window-global)", () => {
    const idWeb = useTabStore.getState().createBrowserTab(W, "https://example.com/");
    useWorkspaceInstancesStore.setState((s) => ({
      windows: {
        ...s.windows,
        [W]: { ...s.windows[W], workspaceInstanceIds: undefined as never },
      },
    }));

    const { result } = renderHook(() => useVisibleWindowTabs(W));

    expect(result.current.map((t) => t.id)).toEqual([idWeb]);
  });
});
