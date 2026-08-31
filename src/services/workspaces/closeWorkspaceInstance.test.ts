// @vitest-environment node
/**
 * Tests for closing a workspace instance from the rail.
 *
 * The rail had no close affordance at all: the only way to remove a workspace
 * was dragging its icon outside the window, which is undiscoverable and easy to
 * trigger by accident. `removeWorkspaceInstance` alone is not enough — it drops
 * the instance from the store while its TABS keep existing, so closing has to
 * route through the same dirty-check path the tab bar uses, and must abort
 * cleanly when the user cancels a save prompt.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const closeTabsWithDirtyCheck = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { useTabStore, type Tab } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { closeWorkspaceInstance } from "./closeWorkspaceInstance";
import { resetInstanceOperationLocks } from "./instanceOperationLock";

function seedInstance(windowLabel: string, instanceId: string, path: string, tabIds: string[]) {
  const rootResult = createWorkspaceRootIdentity(path);
  const root = rootResult.ok ? rootResult.root : null;
  const instance = {
    ...createWorkspaceInstance({
      workspaceInstanceId: instanceId,
      root,
      ownerWindowLabel: windowLabel,
      createdFrom: "open",
    }),
    tabIds,
  };
  useWorkspaceInstancesStore.setState((state) => ({
    instances: { ...state.instances, [instanceId]: instance },
    windows: {
      ...state.windows,
      [windowLabel]: {
        windowLabel,
        workspaceInstanceIds: [
          ...(state.windows[windowLabel]?.workspaceInstanceIds ?? []),
          instanceId,
        ],
        activeWorkspaceInstanceId:
          state.windows[windowLabel]?.activeWorkspaceInstanceId ?? instanceId,
      },
    },
  }));
}

/** Seed a document tab in the tab store, the way ownership actually sees it. */
function addTab(windowLabel: string, tabId: string, filePath: string) {
  // `kind` is the required DocumentTab discriminant; ownership filters on it,
  // so omitting it here would make every seeded tab invisible.
  const tab: Tab = {
    kind: "document",
    id: tabId,
    filePath,
    title: tabId,
    isPinned: false,
    formatId: "markdown",
  };
  useTabStore.setState((state) => ({
    tabs: { ...state.tabs, [windowLabel]: [...(state.tabs[windowLabel] ?? []), tab] },
    activeTabId: { ...state.activeTabId, [windowLabel]: tabId },
  }));
}

const idsIn = (windowLabel: string) =>
  useWorkspaceInstancesStore.getState().windows[windowLabel]?.workspaceInstanceIds ?? [];

beforeEach(() => {
  resetInstanceOperationLocks();
  useWorkspaceInstancesStore.setState({ instances: {}, windows: {} });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  closeTabsWithDirtyCheck.mockReset().mockResolvedValue(true);
  invoke.mockReset().mockResolvedValue(undefined);
});

describe("closeWorkspaceInstance", () => {
  it("closes the workspace's tabs through the shared dirty-check path", async () => {
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1", "tab-2"]);
    addTab("doc-1", "tab-1", "/tmp/alpha/one.md");
    addTab("doc-1", "tab-2", "/tmp/alpha/two.md");

    await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(closeTabsWithDirtyCheck).toHaveBeenCalledWith("doc-1", ["tab-1", "tab-2"]);
  });

  it("ignores stale tab ids that no longer exist", async () => {
    // `instance.tabIds` can outlive the tabs it names. Passing a dead id to the
    // closer is at best a no-op and at worst reaches a recycled id, so
    // ownership is resolved from the LIVE tab store instead.
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1", "tab-gone"]);
    addTab("doc-1", "tab-1", "/tmp/alpha/one.md");

    await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(closeTabsWithDirtyCheck).toHaveBeenCalledWith("doc-1", ["tab-1"]);
  });

  it("closes a tab the workspace owns by path even when tabIds omits it", async () => {
    // The mirror risk: a tab missing from tabIds would be ORPHANED by a close
    // that trusted that list — left open with its workspace gone.
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", []);
    addTab("doc-1", "tab-untracked", "/tmp/alpha/one.md");

    await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    const [, closed] = closeTabsWithDirtyCheck.mock.calls[0];
    expect(closed).toContain("tab-untracked");
  });

  it("refuses a concurrent close of the same workspace", async () => {
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1"]);
    addTab("doc-1", "tab-1", "/tmp/alpha/one.md");
    // Hold the first call inside its save prompt.
    let release: (v: boolean) => void = () => {};
    closeTabsWithDirtyCheck.mockReturnValueOnce(new Promise<boolean>((r) => { release = r; }));

    const first = closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });
    const second = await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    // Without the guard the second call would remove the instance (and close
    // the window) while the first is still awaiting the user.
    expect(second).toEqual({ ok: false, reason: "busy" });
    release(true);
    expect((await first).ok).toBe(true);
  });

  it("reports missing when the instance is not in that window", async () => {
    // It may have moved to another window while the menu was open.
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1"]);

    const result = await closeWorkspaceInstance("doc-2", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(closeTabsWithDirtyCheck).not.toHaveBeenCalled();
  });

  it("removes the instance once its tabs are closed", async () => {
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1"]);
    seedInstance("doc-1", "wsi-b", "/tmp/beta", ["tab-2"]);

    const result = await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(result.ok).toBe(true);
    expect(idsIn("doc-1")).toEqual(["wsi-b"]);
    expect(useWorkspaceInstancesStore.getState().instances["wsi-a"]).toBeUndefined();
  });

  it("does NOT remove the instance when the user cancels a save prompt", async () => {
    // The critical case: a cancelled prompt must leave the workspace and its
    // unsaved work exactly where they were, not half-closed.
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1"]);
    closeTabsWithDirtyCheck.mockResolvedValue(false);

    const result = await closeWorkspaceInstance("doc-1", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("cancelled");
    expect(idsIn("doc-1")).toEqual(["wsi-a"]);
    expect(useWorkspaceInstancesStore.getState().instances["wsi-a"]).toBeDefined();
  });

  it("keeps the main window non-empty by seeding a placeholder", async () => {
    // main is never closed, so it must always hold at least one instance —
    // the same invariant moveWorkspaceInstanceToNewWindow maintains.
    seedInstance("main", "wsi-only", "/tmp/only", ["tab-1"]);

    await closeWorkspaceInstance("main", "wsi-only", { closeTabs: closeTabsWithDirtyCheck });

    const ids = idsIn("main");
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe("wsi-only");
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("closes a non-main window once its last workspace is gone", async () => {
    seedInstance("doc-2", "wsi-only", "/tmp/only", ["tab-1"]);

    await closeWorkspaceInstance("doc-2", "wsi-only", { closeTabs: closeTabsWithDirtyCheck });

    expect(invoke).toHaveBeenCalledWith("close_window", { label: "doc-2" });
  });

  it("leaves other windows alone when one still holds a workspace", async () => {
    seedInstance("doc-2", "wsi-a", "/tmp/alpha", ["tab-1"]);
    seedInstance("doc-2", "wsi-b", "/tmp/beta", ["tab-2"]);

    await closeWorkspaceInstance("doc-2", "wsi-a", { closeTabs: closeTabsWithDirtyCheck });

    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("reports a missing instance instead of throwing", async () => {
    const result = await closeWorkspaceInstance("doc-1", "nope", { closeTabs: closeTabsWithDirtyCheck });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing");
    expect(closeTabsWithDirtyCheck).not.toHaveBeenCalled();
  });
});

describe("tabs appearing during the dirty prompt (audit 20260831 #24)", () => {
  it("re-collects and closes tabs that were opened into the workspace mid-prompt", async () => {
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1"]);
    addTab("doc-1", "tab-1", "/tmp/alpha/one.md");

    const closedBatches: string[][] = [];
    let injected = false;
    const result = await closeWorkspaceInstance("doc-1", "wsi-a", {
      closeTabs: async (windowLabel, tabIds) => {
        closedBatches.push([...tabIds]);
        // The injected closer actually removes what it was handed.
        useTabStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [windowLabel]: (state.tabs[windowLabel] ?? []).filter(
              (t) => !tabIds.includes(t.id),
            ),
          },
        }));
        if (!injected) {
          injected = true;
          // A tab lands in the workspace WHILE the prompt is up — the old
          // single-snapshot flow removed the instance and orphaned it.
          addTab("doc-1", "tab-late", "/tmp/alpha/late.md");
        }
        return true;
      },
    });

    expect(result).toEqual({ ok: true });
    expect(closedBatches[0]).toEqual(["tab-1"]);
    expect(closedBatches[1]).toEqual(["tab-late"]);
    expect(useTabStore.getState().tabs["doc-1"] ?? []).toHaveLength(0);
    expect(idsIn("doc-1")).toEqual([]);
  });
});

describe("convergence bound (audit round 2, R2-12)", () => {
  it("gives up with busy when fresh tabs keep appearing every pass", async () => {
    seedInstance("doc-1", "wsi-a", "/tmp/alpha", ["tab-1"]);
    addTab("doc-1", "tab-1", "/tmp/alpha/one.md");
    // Pathological churn: every prompt round, a NEW owned tab lands in the
    // workspace, so the re-collect never converges.
    let n = 0;
    closeTabsWithDirtyCheck.mockImplementation(async () => {
      n += 1;
      addTab("doc-1", `tab-churn-${n}`, `/tmp/alpha/churn-${n}.md`);
      return true;
    });

    const result = await closeWorkspaceInstance("doc-1", "wsi-a", {
      closeTabs: closeTabsWithDirtyCheck,
    });

    expect(result).toEqual({ ok: false, reason: "busy" });
    // Bounded: exactly MAX_CLOSE_CONVERGENCE_PASSES rounds, then stop — the
    // instance survives (the safe side; nothing was force-removed).
    expect(closeTabsWithDirtyCheck).toHaveBeenCalledTimes(5);
    expect(idsIn("doc-1")).toContain("wsi-a");
  });
});
