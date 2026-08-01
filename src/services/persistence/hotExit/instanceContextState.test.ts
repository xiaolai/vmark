// WI-9.4 — hot-exit capture/restore of per-instance context: UI state with
// outline tab-id remapping, scoped reopen history (verbatim), browser records
// (validated); missing fields tolerated; malformed entries dropped.
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import {
  DEFAULT_INSTANCE_UI_STATE,
  useWorkspaceInstanceUiStore,
} from "@/stores/workspaceInstanceUiStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { resetWindowBrowserSessionRestores } from "@/services/persistence/windowBrowserSession";
import {
  captureInstanceContextState,
  restoreInstanceContextState,
} from "./instanceContextState";
import type { WindowState } from "./types";

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

function emptyWindowState(extra: Partial<WindowState> = {}): WindowState {
  return {
    window_label: W,
    is_main_window: true,
    active_tab_id: null,
    tabs: [],
    ui_state: {} as WindowState["ui_state"],
    geometry: null,
    ...extra,
  };
}

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
  useClosedTabScopesStore.getState().resetClosedScopes();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  resetWindowBrowserSessionRestores();
  setRail(true);
  addWorkspace("wsi-a", "/repo-a");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

describe("instanceContextState (WI-9.4)", () => {
  it("captures UI state, closed scopes, and browser records for the window", () => {
    useWorkspaceInstanceUiStore.getState().updateInstanceUiState("wsi-a", { sidebarWidth: 240 });
    const tabId = useTabStore.getState().createTab(W, "/repo-a/x.md");
    useTabStore.getState().closeTab(W, tabId);
    useTabStore.getState().createBrowserPage(W, "https://keep.example/", "Keep", "human");

    const capture = captureInstanceContextState(W);

    expect(capture.ui_state_by_instance).toMatchObject({
      "wsi-a": { sidebarWidth: 240 },
    });
    expect(Object.keys(capture.closed_tab_scopes ?? {})).toContain("wsi-a");
    expect(JSON.stringify(capture.browser_session)).toContain("keep.example");
  });

  it("round-trips: outline tab ids remap; reopen history survives verbatim", () => {
    useWorkspaceInstanceUiStore.getState().updateOutlineTabState("wsi-a", "old-tab", {
      collapsedKeys: ["1:1:Intro"],
    });
    const closedId = useTabStore.getState().createTab(W, "/repo-a/closed.md");
    useTabStore.getState().closeTab(W, closedId);
    const capture = captureInstanceContextState(W);

    // Simulate restart.
    useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
    useClosedTabScopesStore.getState().resetClosedScopes();

    restoreInstanceContextState(
      W,
      emptyWindowState(capture as Partial<WindowState>),
      new Map([["old-tab", "new-tab"]]),
    );

    const ui = useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a");
    expect(ui.outlineByTabId["new-tab"]).toMatchObject({ collapsedKeys: ["1:1:Intro"] });
    expect(ui.outlineByTabId["old-tab"]).toBeUndefined();
    expect(
      useClosedTabScopesStore.getState().closedIdsForScope(W, "wsi-a"),
    ).toEqual([closedId]);
  });

  it("tolerates an old payload with none of the new fields", () => {
    expect(() =>
      restoreInstanceContextState(W, emptyWindowState(), new Map()),
    ).not.toThrow();
    expect(useWorkspaceInstanceUiStore.getState().instanceUiStates).toEqual({});
  });

  it("drops malformed UI entries and closed entries at hydrate", () => {
    restoreInstanceContextState(
      W,
      emptyWindowState({
        ui_state_by_instance: { "wsi-bad": { sidebarWidth: "wide" } as never },
        closed_tab_scopes: { "wsi-a": [{ nonsense: true }] as never },
      }),
      new Map(),
    );

    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-bad"))
      .toEqual(DEFAULT_INSTANCE_UI_STATE);
    expect(useClosedTabScopesStore.getState().closedIdsForScope(W, "wsi-a")).toEqual([]);
  });

  it("drops ui_state entries for instances not in this window (R2-F16)", () => {
    restoreInstanceContextState(
      W,
      emptyWindowState({
        ui_state_by_instance: {
          "wsi-a": { ...DEFAULT_INSTANCE_UI_STATE, sidebarWidth: 300 },
          "wsi-foreign": { ...DEFAULT_INSTANCE_UI_STATE, sidebarWidth: 111 },
        } as never,
      }),
      new Map(),
    );

    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").sidebarWidth,
    ).toBe(300);
    expect(
      useWorkspaceInstanceUiStore.getState().instanceUiStates["wsi-foreign"],
    ).toBeUndefined();
  });

  it("restores browser records without stealing activation (validated gate)", () => {
    const docId = useTabStore.getState().createTab(W, "/repo-a/doc.md");
    useTabStore.getState().setActiveTab(W, docId);

    restoreInstanceContextState(
      W,
      emptyWindowState({
        browser_session: {
          version: 1,
          tabs: [
            { kind: "browser", url: "https://ok.example/", title: "OK" },
            { kind: "browser", url: "javascript:alert(1)", title: "evil" },
          ],
        },
      }),
      new Map(),
    );

    const browserTabs = useTabStore.getState().getTabsByWindow(W).filter((t) => t.kind === "browser");
    expect(browserTabs).toHaveLength(1);
    expect(useTabStore.getState().activeTabId[W]).toBe(docId);
  });
});
