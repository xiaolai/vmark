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
vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));

const mockPersistWorkspaceSession = vi.fn();
vi.mock("@/hooks/workspaceSession", () => ({
  persistWorkspaceSession: (...a: unknown[]) => mockPersistWorkspaceSession(...a),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn() }));

import { executeCommand, listCommands, _resetCommandBus } from "./CommandBus";
import {
  registerWorkspaceCommands,
  __resetWorkspaceCommandsRegistration,
} from "./workspaceCommands";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  _resetCommandBus();
  __resetWorkspaceCommandsRegistration();
  mockOpenPicker.mockReset();
  mockAsk.mockReset();
  mockPersistWorkspaceSession.mockReset().mockResolvedValue(undefined);
  mockOpenWorkspaceWithConfig.mockReset().mockResolvedValue(null);
  useUIStore.setState({ sidebarVisible: false, sidebarViewMode: "outline" });
  // Pretend there is a dirty tab open — the old code would have shown a dialog.
  useTabStore.setState({
    tabs: { "tab-1": { id: "tab-1", windowLabel: "main" } } as never,
    activeTabId: { main: "tab-1" },
    untitledCounter: 0,
    closedTabs: {},
  });
  registerWorkspaceCommands();
});

afterEach(() => {
  _resetCommandBus();
});

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("does not throw when the module flag resets but the bus registry survives", () => {
    const before = listCommands().length;
    // Simulate Vite HMR: the registrar module re-instantiates (module-local
    // `registered` flag resets) while CommandBus's REGISTRY survives.
    __resetWorkspaceCommandsRegistration();
    expect(() => registerWorkspaceCommands()).not.toThrow();
    expect(listCommands().length).toBe(before);
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
