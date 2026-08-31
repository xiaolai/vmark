// @vitest-environment node
// Audit 20260831 R2-10 — the ONE post-removal lifecycle. Close and move had
// grown drifting copies before it existed; these tests pin the dispatch
// table: what each mode cleans, what move deliberately leaves (rail-plan gap
// G2), the main-placeholder / empty-window invariants, and successor
// hydration only when the removed instance was ACTIVE.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const hydrateWorkspaceInstanceContext = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("./hydrateWorkspaceInstanceContext", () => ({
  hydrateWorkspaceInstanceContext: (...args: unknown[]) =>
    hydrateWorkspaceInstanceContext(...args),
}));

import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspacePaneLayoutsStore } from "@/stores/workspacePaneLayoutsStore";
import type { Tab } from "@/stores/tabStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import { finalizeInstanceRemoval } from "./finalizeInstanceRemoval";

function seedInstance(windowLabel: string, instanceId: string, path: string): void {
  const rootResult = createWorkspaceRootIdentity(path, { platform: "macos" });
  if (!rootResult.ok) throw new Error("bad test root");
  const instance = createWorkspaceInstance({
    workspaceInstanceId: instanceId,
    root: rootResult.root,
    ownerWindowLabel: windowLabel,
    createdFrom: "open",
  });
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

/** Seed the parallel per-instance state the finalizer is expected to manage. */
function seedParallelState(windowLabel: string, instanceId: string): void {
  useWorkspaceInstanceUiStore
    .getState()
    .updateInstanceUiState(instanceId, { sidebarWidth: 321 });
  // enabled: true — stashPaneLayout deliberately DELETES a disabled split,
  // so a disabled seed would never be stored in the first place.
  useWorkspacePaneLayoutsStore.getState().stashPaneLayout(instanceId, {
    enabled: true,
    orientation: "horizontal",
    fraction: 0.5,
    primaryTabId: "t-1",
    secondaryTabId: "t-2",
    focusedPane: "primary",
    syncScroll: false,
  });
  useUIStore.getState().terminalCreateSession({ ownerInstanceId: instanceId });
  const tab: Tab = {
    kind: "document",
    id: `closed-${instanceId}`,
    filePath: `/repo/${instanceId}.md`,
    title: instanceId,
    isPinned: false,
    formatId: "markdown",
  };
  useClosedTabScopesStore.setState((state) => ({
    scopesByWindow: {
      ...state.scopesByWindow,
      [windowLabel]: {
        ...state.scopesByWindow[windowLabel],
        [instanceId]: [{ tab, closedSeq: 1 }],
      },
    },
  }));
}

const instancesState = () => useWorkspaceInstancesStore.getState();
const uiStates = () => useWorkspaceInstanceUiStore.getState().instanceUiStates;
const paneLayout = (id: string) =>
  useWorkspacePaneLayoutsStore.getState().getPaneLayout(id);
const terminalScopeSessions = (id: string) =>
  useUIStore
    .getState()
    .terminal.sessions.filter((s) => s.workspaceInstanceId === id);
const closedScope = (windowLabel: string, id: string) =>
  useClosedTabScopesStore.getState().scopesByWindow[windowLabel]?.[id];

beforeEach(() => {
  resetTerminalSessionStore();
  useWorkspaceInstancesStore.setState({ instances: {}, windows: {} });
  useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
  useWorkspacePaneLayoutsStore.getState().resetPaneLayouts();
  useClosedTabScopesStore.getState().resetClosedScopes();
  invoke.mockReset().mockResolvedValue(undefined);
  hydrateWorkspaceInstanceContext.mockReset().mockResolvedValue(undefined);
});

describe("finalizeInstanceRemoval — mode dispatch table (R2-10)", () => {
  it.each([
    { mode: "close", cleanupPerInstanceUi: true, uiSurvives: false },
    { mode: "move", cleanupPerInstanceUi: false, uiSurvives: true },
  ])(
    "$mode: terminal scope + closed history always cleaned; UI/pane cleaned only on close",
    async ({ cleanupPerInstanceUi, uiSurvives }) => {
      seedInstance("main", "wsi-a", "/repo-a");
      seedInstance("main", "wsi-b", "/repo-b");
      seedParallelState("main", "wsi-b");

      await finalizeInstanceRemoval("main", "wsi-b", { cleanupPerInstanceUi });

      // Always: instance gone, terminal scope killed, closed history dropped.
      expect(instancesState().instances["wsi-b"]).toBeUndefined();
      expect(terminalScopeSessions("wsi-b")).toHaveLength(0);
      expect(closedScope("main", "wsi-b")).toBeUndefined();
      // Mode-dependent: move leaves UI/pane snapshots (rail-plan gap G2,
      // deferred there — the finalizer must not silently half-fix it).
      expect("wsi-b" in uiStates()).toBe(uiSurvives);
      expect(paneLayout("wsi-b") !== null).toBe(uiSurvives);
    },
  );

  it("main is never left with an empty rail — a placeholder is ensured", async () => {
    seedInstance("main", "wsi-a", "/repo-a");

    await finalizeInstanceRemoval("main", "wsi-a", { cleanupPerInstanceUi: true });

    const ids = instancesState().windows["main"]?.workspaceInstanceIds ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => instancesState().instances[id]?.kind === "placeholder")).toBe(
      true,
    );
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("a non-main window emptied by the removal closes itself", async () => {
    seedInstance("doc-1", "wsi-a", "/repo-a");

    await finalizeInstanceRemoval("doc-1", "wsi-a", { cleanupPerInstanceUi: true });

    expect(invoke).toHaveBeenCalledWith("close_window", { label: "doc-1" });
  });

  it("a non-main window with instances left does NOT close", async () => {
    seedInstance("doc-1", "wsi-a", "/repo-a");
    seedInstance("doc-1", "wsi-b", "/repo-b");

    await finalizeInstanceRemoval("doc-1", "wsi-b", { cleanupPerInstanceUi: true });

    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("removing the ACTIVE instance hydrates the promoted successor's full context", async () => {
    seedInstance("main", "wsi-a", "/repo-a"); // active (seeded first)
    seedInstance("main", "wsi-b", "/repo-b");

    await finalizeInstanceRemoval("main", "wsi-a", { cleanupPerInstanceUi: true });

    expect(hydrateWorkspaceInstanceContext).toHaveBeenCalledWith("main");
  });

  it("removing an INACTIVE instance touches no context", async () => {
    seedInstance("main", "wsi-a", "/repo-a"); // active
    seedInstance("main", "wsi-b", "/repo-b");

    await finalizeInstanceRemoval("main", "wsi-b", { cleanupPerInstanceUi: true });

    expect(hydrateWorkspaceInstanceContext).not.toHaveBeenCalled();
  });
});
