// @vitest-environment node
// WI-9.4 — hot-exit capture/restore of per-instance context: UI state with
// outline tab-id remapping, scoped reopen history (verbatim), browser records
// (validated); missing fields tolerated; malformed entries dropped.
// WI-3 — the opaque WindowState fields are now Zod-validated at this read
// boundary; entries that fail parsing are quarantined (preserved), never
// silently destroyed (decision ledger D5: passthrough posture).
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { writeTextFile } from "@tauri-apps/plugin-fs";
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

  it("round-trips: outline tab ids remap; reopen history survives verbatim", async () => {
    useWorkspaceInstanceUiStore.getState().updateOutlineTabState("wsi-a", "old-tab", {
      collapsedKeys: ["1:1:Intro"],
    });
    const closedId = useTabStore.getState().createTab(W, "/repo-a/closed.md");
    useTabStore.getState().closeTab(W, closedId);
    const capture = captureInstanceContextState(W);

    // Simulate restart.
    useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
    useClosedTabScopesStore.getState().resetClosedScopes();

    await restoreInstanceContextState(
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

  it("tolerates an old payload with none of the new fields", async () => {
    await expect(
      restoreInstanceContextState(W, emptyWindowState(), new Map()),
    ).resolves.toBe(true);
    expect(useWorkspaceInstanceUiStore.getState().instanceUiStates).toEqual({});
  });

  it("drops malformed UI entries and closed entries at hydrate", async () => {
    await restoreInstanceContextState(
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

  it("drops ui_state entries for instances not in this window (R2-F16)", async () => {
    await restoreInstanceContextState(
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

  it("quarantines a corrupt UI entry for a registered instance instead of silently dropping it (WI-3)", async () => {
    const quarantineFs = new Map<string, string>();
    (writeTextFile as Mock).mockImplementation((path: string, contents: string) => {
      quarantineFs.set(path, contents);
      return Promise.resolve();
    });
    const corrupt = { sidebarWidth: "wide", outlineByTabId: {} };

    await restoreInstanceContextState(
      W,
      emptyWindowState({ ui_state_by_instance: { "wsi-a": corrupt } as never }),
      new Map(),
    );

    // Boundary rejects it; the store never sees the junk.
    expect(useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a"))
      .toEqual(DEFAULT_INSTANCE_UI_STATE);
    // The corrupt bytes are preserved in a quarantine artifact.
    await vi.waitFor(() => {
      expect(quarantineFs.size).toBe(1);
    });
    const [artifactPath, contents] = [...quarantineFs.entries()][0];
    expect(artifactPath).toMatch(/session\.corrupt-[0-9a-f]+\.json$/);
    const artifact = JSON.parse(contents);
    expect(artifact.entries[0].payload).toEqual(corrupt);
    (writeTextFile as Mock).mockReset();
  });

  it("passes a valid UI entry with unknown extra fields through to the store (WI-3 passthrough)", async () => {
    await restoreInstanceContextState(
      W,
      emptyWindowState({
        ui_state_by_instance: {
          "wsi-a": { ...DEFAULT_INSTANCE_UI_STATE, sidebarWidth: 320, futureField: "x" },
        } as never,
      }),
      new Map(),
    );
    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").sidebarWidth,
    ).toBe(320);
  });

  it("skips and quarantines a wrong-typed closed_tab_scopes payload without throwing (WI-3)", async () => {
    const quarantineFs = new Map<string, string>();
    (writeTextFile as Mock).mockImplementation((path: string, contents: string) => {
      quarantineFs.set(path, contents);
      return Promise.resolve();
    });

    await expect(
      restoreInstanceContextState(
        W,
        emptyWindowState({ closed_tab_scopes: "nonsense" as never }),
        new Map(),
      ),
    ).resolves.toBe(true);

    expect(useClosedTabScopesStore.getState().closedIdsForScope(W, "wsi-a")).toEqual([]);
    await vi.waitFor(() => {
      expect(quarantineFs.size).toBe(1);
    });
    const artifact = JSON.parse([...quarantineFs.values()][0]);
    expect(artifact.entries[0].payload).toBe("nonsense");
    (writeTextFile as Mock).mockReset();
  });

  /**
   * Audit 20260804-F12 — the quarantine write used to be fire-and-forget
   * (`void quarantineSessionEntries(...)`), so restore reported success while
   * the artifact was still in flight, or after it had already failed. The
   * caller clears the session file on success — so the rejected payloads
   * ended up existing nowhere at all, which is the single outcome quarantine
   * exists to prevent.
   */
  describe("the clear is gated on the quarantine write (F12)", () => {
    const corruptState = () =>
      emptyWindowState({
        ui_state_by_instance: { "wsi-a": { sidebarWidth: "wide" } } as never,
      });

    it("does not resolve until a DELAYED write completes", async () => {
      let release!: () => void;
      const written: string[] = [];
      (writeTextFile as Mock).mockImplementation((path: string) => {
        return new Promise<void>((resolve) => {
          release = () => {
            written.push(path);
            resolve();
          };
        });
      });

      let settled = false;
      const pending = restoreInstanceContextState(W, corruptState(), new Map()).then(
        (result) => {
          settled = true;
          return result;
        },
      );

      // The write has been ISSUED but not completed…
      await vi.waitFor(() => {
        expect(writeTextFile as Mock).toHaveBeenCalled();
      });
      // …and restore has not reported an outcome yet. Before the fix it had
      // already resolved here, which is what let the caller clear the file.
      expect(settled).toBe(false);
      expect(written).toHaveLength(0);

      release();
      await expect(pending).resolves.toBe(true);
      expect(written).toHaveLength(1);
      (writeTextFile as Mock).mockReset();
    });

    it("reports false when the write REJECTS, so the caller keeps the session", async () => {
      (writeTextFile as Mock).mockImplementation(() =>
        Promise.reject(new Error("EROFS: read-only file system")),
      );

      await expect(
        restoreInstanceContextState(W, corruptState(), new Map()),
      ).resolves.toBe(false);

      (writeTextFile as Mock).mockReset();
    });

    it("still restores the rest of the window when the write rejects", async () => {
      // Reporting the failure must not become "restore nothing" — the user's
      // tabs are not the corrupt fragment's hostage.
      (writeTextFile as Mock).mockImplementation(() => Promise.reject(new Error("nope")));

      const preserved = await restoreInstanceContextState(
        W,
        emptyWindowState({
          ui_state_by_instance: { "wsi-a": { sidebarWidth: "wide" } } as never,
          browser_session: {
            version: 1,
            tabs: [{ kind: "browser", url: "https://ok.example/", title: "OK" }],
          },
        }),
        new Map(),
      );

      expect(preserved).toBe(false);
      const browserTabs = useTabStore
        .getState()
        .getTabsByWindow(W)
        .filter((t) => t.kind === "browser");
      expect(browserTabs).toHaveLength(1);
      (writeTextFile as Mock).mockReset();
    });

    it("reports true without touching disk when nothing was rejected", async () => {
      (writeTextFile as Mock).mockImplementation(() => Promise.reject(new Error("nope")));

      await expect(
        restoreInstanceContextState(
          W,
          emptyWindowState({
            ui_state_by_instance: {
              "wsi-a": { ...DEFAULT_INSTANCE_UI_STATE, sidebarWidth: 300 },
            } as never,
          }),
          new Map(),
        ),
      ).resolves.toBe(true);

      expect(writeTextFile as Mock).not.toHaveBeenCalled();
      (writeTextFile as Mock).mockReset();
    });
  });

  it("restores browser records without stealing activation (validated gate)", async () => {
    const docId = useTabStore.getState().createTab(W, "/repo-a/doc.md");
    useTabStore.getState().setActiveTab(W, docId);

    await restoreInstanceContextState(
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
