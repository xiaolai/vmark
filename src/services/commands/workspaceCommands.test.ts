// @vitest-environment node
/**
 * Tests for the "Open Workspace" command (#1005).
 *
 * Opening a workspace lands in the CURRENT window — no forced "Open in New
 * Window?" dialog (which lacked a current-window option and duplicated its
 * title on Linux). Verifies the workspace is opened and the file explorer is
 * revealed, and that the old native dialog is never shown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockOpenPicker = vi.fn();
const mockAsk = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => mockOpenPicker(...a),
  ask: (...a: unknown[]) => mockAsk(...a),
}));

const mockOpenWorkspaceWithConfig = vi.fn();
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));

const mockPersistWorkspaceSession = vi.fn();
vi.mock("@/services/workspaces/workspaceSession", () => ({
  persistWorkspaceSession: (...a: unknown[]) => mockPersistWorkspaceSession(...a),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn() }));

const mockToastError = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...a: unknown[]) => mockToastError(...a), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import { executeCommand, listCommands, registerCommand, _resetCommandBus } from "./CommandBus";
import {
  registerWorkspaceCommands,
  __resetWorkspaceCommandsRegistration,
} from "./workspaceCommands";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  selectActiveWorkspaceInstance,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { createUntitledTab } from "@/services/navigation/newFile";
import { tabBelongsToWorkspace } from "@/services/workspaces/workspaceTabCollection";

beforeEach(() => {
  _resetCommandBus();
  __resetWorkspaceCommandsRegistration();
  mockOpenPicker.mockReset();
  mockAsk.mockReset();
  mockPersistWorkspaceSession.mockReset().mockResolvedValue(undefined);
  mockToastError.mockReset();
  mockOpenWorkspaceWithConfig.mockReset().mockResolvedValue(null);
  useUIStore.setState({ sidebarVisible: false, sidebarViewMode: "outline" });
  // Pretend there is a dirty tab open — the old code would have shown a dialog.
  useTabStore.setState({
    tabs: { "tab-1": { id: "tab-1", windowLabel: "main" } } as never,
    activeTabId: { main: "tab-1" },
    untitledCounter: 0,
  });
  registerWorkspaceCommands();
});

afterEach(() => {
  _resetCommandBus();
});


/** A real root identity for the railed workspace under test (a string is not one). */
function fooRoot() {
  const root = createWorkspaceRootIdentity("/projects/foo", { displayName: "foo", platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  return root.root;
}

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("does not throw when the module flag resets but the bus registry survives", () => {
    const before = listCommands().length;
    // Simulate Vite HMR: the registrar module re-instantiates (module-local
    // `registered` flag resets) while CommandBus's REGISTRY survives.
    __resetWorkspaceCommandsRegistration();
    expect(() => registerWorkspaceCommands()).not.toThrow();
    expect(listCommands().length).toBe(before);
  });

  // Audit 20260907 (#464): the first-command sentinel took an identically
  // named command from ANOTHER registrar as "already registered" and skipped
  // the whole group; owner-based batch registration refuses the collision.
  it("refuses a foreign registration of its first id instead of silently skipping the group", () => {
    _resetCommandBus();
    registerCommand({ id: "workspace.openFolder", title: "impostor", run: () => {} });
    expect(() => registerWorkspaceCommands()).toThrow(/already registered/);
  });
});

describe("workspace.openFolder (#1005)", () => {
  it("opens the selected workspace in the current window without a dialog", async () => {
    mockOpenPicker.mockResolvedValue("/projects/foo");

    await executeCommand("workspace.openFolder", {}, { windowLabel: "main" });

    // Opened the picked workspace…
    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/projects/foo", {
      windowLabel: "main",
    });
    // …revealed the file explorer…
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    expect(useUIStore.getState().sidebarViewMode).toBe("files");
    // …and never showed the old forced "Open in New Window?" dialog.
    expect(mockAsk).not.toHaveBeenCalled();
  });

  // #1252 — the picker must grant the workspace RECURSIVELY.
  //
  // tauri-plugin-dialog extends the fs scope for a picked directory with
  // `allow_directory(&path, options.recursive)`. Without `recursive: true`
  // only the folder ITSELF enters the scope, so opening any file inside it
  // fails with `forbidden path: …`.
  //
  // It reproduces only off the home drive: the static scope in
  // capabilities/default.json covers `$HOME/**`, `/Volumes/**`, `/mnt/**` and
  // `/media/**`, which masks the missing grant on macOS and Linux. On Windows
  // `$HOME` is `C:\Users\<name>`, so a workspace on `G:\` is covered by
  // nothing and every file click is refused.
  it("grants the picked workspace recursively so its files are in scope", async () => {
    mockOpenPicker.mockResolvedValue("/projects/foo");

    await executeCommand("workspace.openFolder", {}, { windowLabel: "main" });

    expect(mockOpenPicker).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, recursive: true })
    );
  });

  it("does nothing when the folder picker is cancelled", async () => {
    mockOpenPicker.mockResolvedValue(null);

    await executeCommand("workspace.openFolder", {}, { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("ignores re-activation while the folder picker is already open (reentry guard)", async () => {
    let resolvePicker!: (value: string | null) => void;
    mockOpenPicker.mockImplementation(
      () => new Promise<string | null>((resolve) => { resolvePicker = resolve; }),
    );

    const first = executeCommand("workspace.openFolder", {}, { windowLabel: "main" });
    // Second activation while the picker is still open must be a no-op —
    // without the guard it would open an overlapping picker.
    await executeCommand("workspace.openFolder", {}, { windowLabel: "main" });
    expect(mockOpenPicker).toHaveBeenCalledTimes(1);

    resolvePicker(null);
    await first;

    // Guard released after completion: the command works again.
    mockOpenPicker.mockResolvedValue(null);
    await executeCommand("workspace.openFolder", {}, { windowLabel: "main" });
    expect(mockOpenPicker).toHaveBeenCalledTimes(2);
  });
});

describe("workspace.close", () => {
  it("persists the window's session, then closes the workspace", async () => {
    const closeWorkspace = vi.fn();
    useWorkspaceStore.setState({ closeWorkspace } as never);

    await executeCommand("workspace.close", {}, { windowLabel: "main" });

    expect(mockPersistWorkspaceSession).toHaveBeenCalledWith("main");
    expect(closeWorkspace).toHaveBeenCalledTimes(1);
    // The session snapshot must be taken BEFORE workspace state is torn down.
    expect(mockPersistWorkspaceSession.mock.invocationCallOrder[0]).toBeLessThan(
      closeWorkspace.mock.invocationCallOrder[0],
    );
  });

  it("ignores re-activation while a close is still persisting (reentry guard)", async () => {
    const closeWorkspace = vi.fn();
    useWorkspaceStore.setState({ closeWorkspace } as never);
    let finishPersist!: () => void;
    mockPersistWorkspaceSession.mockImplementation(
      () => new Promise<void>((resolve) => { finishPersist = () => resolve(); }),
    );

    const first = executeCommand("workspace.close", {}, { windowLabel: "main" });
    // A second close while the session write is in flight would run a second
    // concurrent persist — last writer wins over a half-torn-down workspace.
    await executeCommand("workspace.close", {}, { windowLabel: "main" });
    expect(mockPersistWorkspaceSession).toHaveBeenCalledTimes(1);

    finishPersist();
    await first;
    expect(closeWorkspace).toHaveBeenCalledTimes(1);
  });

  it("does not run while a workspace open is in flight in the same window", async () => {
    const closeWorkspace = vi.fn();
    useWorkspaceStore.setState({ closeWorkspace } as never);
    let resolvePicker!: (value: string | null) => void;
    mockOpenPicker.mockImplementation(
      () => new Promise<string | null>((resolve) => { resolvePicker = resolve; }),
    );

    const opening = executeCommand("workspace.openFolder", {}, { windowLabel: "main" });
    await executeCommand("workspace.close", {}, { windowLabel: "main" });

    // Open and close are both workspace transitions: interleaving them tears
    // down the workspace the open is still restoring into.
    expect(mockPersistWorkspaceSession).not.toHaveBeenCalled();
    expect(closeWorkspace).not.toHaveBeenCalled();

    resolvePicker(null);
    await opening;
  });
});

// File → Close Workspace under the workspace rail. The legacy path only nulls
// the workspace store; with the rail on that left the closed workspace's
// instance registered and ACTIVE with no root. The status-bar tab strip is
// scoped to the active instance, so it had nothing to show and unmounted, and
// every new untitled tab was claimed into the inactive "Loose Files" —
// invisible. Observed live 2026-09-07 through the e2e suite (five journeys
// failed on `scratch tab to appear — last observed: []`).
describe("workspace.close under the workspace rail", () => {
  const railMode = (enabled: boolean) =>
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
    });

  beforeEach(() => {
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(
      createWorkspaceInstance({
        workspaceInstanceId: "wsi-foo",
        root: fooRoot(),
        ownerWindowLabel: "main",
        createdFrom: "open",
      }),
    );
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-foo");
    // Earlier tests swap the store's closeWorkspace for a spy and Zustand state
    // persists across tests; the rail path must run the REAL action.
    useWorkspaceStore.setState({
      rootPath: "/projects/foo",
      isWorkspaceMode: true,
      config: null,
      closeWorkspace: useWorkspaceStore.getInitialState().closeWorkspace,
    });
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  });

  afterEach(() => {
    railMode(false);
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  });

  it("rail on: removes the active railed workspace, so no rootless workspace stays active and a new tab is visible", async () => {
    railMode(true);

    await executeCommand("workspace.close", {}, { windowLabel: "main" });

    expect(mockPersistWorkspaceSession).toHaveBeenCalledWith("main");
    const state = useWorkspaceInstancesStore.getState();
    expect(state.windows.main?.workspaceInstanceIds).not.toContain("wsi-foo");
    const active = selectActiveWorkspaceInstance(state, "main");
    // The successor is a scope that legitimately has no root (loose files or
    // the main-window placeholder) — never a "workspace" instance whose root
    // has just been closed underneath it.
    expect(active).not.toBeNull();
    expect(active?.kind).not.toBe("workspace");
    expect(useWorkspaceStore.getState().rootPath).toBeNull();

    // What the user does next: Cmd+N. The tab must be owned by the ACTIVE
    // scope — the rule the status-bar strip renders by — not by a hidden one.
    const tabId = createUntitledTab("main");
    const tab = useTabStore.getState().getTabsByWindow("main").find((t) => t.id === tabId);
    expect(tab).toBeDefined();
    if (tab?.kind !== "document") throw new Error("Cmd+N creates a document tab");
    const after = useWorkspaceInstancesStore.getState();
    const activeAfter = selectActiveWorkspaceInstance(after, "main");
    expect(activeAfter).not.toBeNull();
    expect(
      tabBelongsToWorkspace(tab as DocumentTab, activeAfter!, activeAfter!.workspaceInstanceId),
    ).toBe(true);
  });

  it("rail off: the legacy close is unchanged and the instance store is untouched", async () => {
    railMode(false);
    const closeWorkspace = vi.fn();
    useWorkspaceStore.setState({ closeWorkspace } as never);

    await executeCommand("workspace.close", {}, { windowLabel: "main" });

    expect(mockPersistWorkspaceSession).toHaveBeenCalledWith("main");
    expect(closeWorkspace).toHaveBeenCalledTimes(1);
    const state = useWorkspaceInstancesStore.getState();
    expect(state.windows.main?.workspaceInstanceIds).toContain("wsi-foo");
    expect(state.windows.main?.activeWorkspaceInstanceId).toBe("wsi-foo");
  });
});

// Audit #953 — Open Workspace contained and logged its failures; Close
// Workspace did neither, so a failed session write, a throwing dirty-close or a
// rail finalization that rejected escaped into the command bus: a log line on
// the menu route, and a dropped rejection on the palette route.
describe("workspace.close contains and reports an unexpected failure", () => {
  it("does not reject the dispatch when persisting the session throws", async () => {
    mockPersistWorkspaceSession.mockRejectedValue(new Error("disk full"));

    await expect(
      executeCommand("workspace.close", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it("stays silent on the happy path", async () => {
    await executeCommand("workspace.close", undefined, { windowLabel: "main" });

    expect(mockToastError).not.toHaveBeenCalled();
  });
});
