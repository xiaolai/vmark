/**
 * Tests for Open Recent Workspace command (ADR-012).
 *
 * Covers arg validation, missing-workspace removal, the dirty-tab new-window
 * flow (including IPC failure feedback), and the tab-restore path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExists = vi.fn();
const mockAsk = vi.fn();
const mockOpenPicker = vi.fn();
const mockInvoke = vi.fn();
const mockOpenWorkspaceWithConfig = vi.fn();
const mockRestoreWorkspaceTabs = vi.fn();
const mockToastError = vi.fn();
const mockPersistWorkspaceSession = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({ exists: (...a: unknown[]) => mockExists(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...a: unknown[]) => mockAsk(...a),
  open: (...a: unknown[]) => mockOpenPicker(...a),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));
vi.mock("@/hooks/workspaceSession", () => ({
  persistWorkspaceSession: (...a: unknown[]) => mockPersistWorkspaceSession(...a),
}));
vi.mock("@/services/navigation/restoreWorkspaceTabs", () => ({
  restoreWorkspaceTabs: (...a: unknown[]) => mockRestoreWorkspaceTabs(...a),
  restoreSplitLayout: () => {},
}));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { error: (...a: unknown[]) => mockToastError(...a) } }));

import { executeCommand, listCommands, _resetCommandBus } from "./CommandBus";
import {
  registerRecentWorkspacesCommands,
  __resetRecentWorkspacesCommandsRegistration,
} from "./recentWorkspacesCommands";
import {
  registerWorkspaceCommands,
  __resetWorkspaceCommandsRegistration,
} from "./workspaceCommands";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// The dirty-tab tests below stub the stores' METHODS via setState. Zustand
// merges, so those stubs would leak into every later test unless the real
// implementations (captured here, before any test runs) are restored each time.
const realGetTabsByWindow = useTabStore.getState().getTabsByWindow;
const realGetDocument = useDocumentStore.getState().getDocument;

beforeEach(() => {
  _resetCommandBus();
  __resetRecentWorkspacesCommandsRegistration();
  __resetWorkspaceCommandsRegistration();
  [mockExists, mockAsk, mockOpenPicker, mockInvoke, mockOpenWorkspaceWithConfig,
    mockRestoreWorkspaceTabs, mockToastError, mockPersistWorkspaceSession]
    .forEach((m) => m.mockReset());
  mockExists.mockResolvedValue(true);
  mockOpenWorkspaceWithConfig.mockResolvedValue(null);
  mockRestoreWorkspaceTabs.mockResolvedValue(0);
  mockInvoke.mockResolvedValue(undefined);
  mockPersistWorkspaceSession.mockResolvedValue(undefined);
  useRecentWorkspacesStore.setState({ workspaces: [{ path: "/repo" }] } as never);
  useTabStore.setState({
    tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {},
    getTabsByWindow: realGetTabsByWindow,
  } as never);
  useDocumentStore.setState({ documents: {}, getDocument: realGetDocument } as never);
  registerRecentWorkspacesCommands();
});

afterEach(() => {
  _resetCommandBus();
  __resetWorkspaceCommandsRegistration();
});

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("does not throw when the module flag resets but the bus registry survives", () => {
    const before = listCommands().length;
    // Simulate Vite HMR: the registrar module re-instantiates (module-local
    // `registered` flag resets) while CommandBus's REGISTRY survives.
    __resetRecentWorkspacesCommandsRegistration();
    expect(() => registerRecentWorkspacesCommands()).not.toThrow();
    expect(listCommands().length).toBe(before);
  });
});

describe("workspace.openRecent", () => {
  it.each([[[]], [[null]], [null], [undefined], [""]])(
    "rejects non-string args (%j) without touching the filesystem",
    async (args) => {
      await executeCommand("workspace.openRecent", args, { windowLabel: "main" });
      expect(mockExists).not.toHaveBeenCalled();
    },
  );

  it("removes a missing workspace from recents on confirm", async () => {
    mockExists.mockResolvedValue(false);
    mockAsk.mockResolvedValue(true);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(useRecentWorkspacesStore.getState().workspaces).toEqual([]);
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("opens the workspace and restores its tabs when not dirty", async () => {
    mockExists.mockResolvedValue(true);
    mockOpenWorkspaceWithConfig.mockResolvedValue({ lastOpenTabs: ["/repo/a.md"] });

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
    expect(mockRestoreWorkspaceTabs).toHaveBeenCalledWith("main", ["/repo/a.md"]);
    expect(useRecentWorkspacesStore.getState().workspaces).toContainEqual(
      expect.objectContaining({ path: "/repo" }),
    );
  });

  it("opens in a new window when there are dirty tabs and the user confirms", async () => {
    useTabStore.setState({
      tabs: { main: [{ id: "t1", filePath: "/x.md" }] },
      activeTabId: { main: "t1" },
      getTabsByWindow: () => [{ id: "t1", filePath: "/x.md" }],
    } as never);
    useDocumentStore.setState({
      documents: { t1: { isDirty: true } },
      getDocument: () => ({ isDirty: true }),
    } as never);
    mockAsk.mockResolvedValue(true);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/repo",
      filePath: null,
    });
    // Did not open in the current window.
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("is skipped while a workspace open is already in flight in the same window", async () => {
    registerWorkspaceCommands();
    let resolvePicker!: (value: string | null) => void;
    mockOpenPicker.mockImplementation(
      () => new Promise<string | null>((resolve) => { resolvePicker = resolve; }),
    );

    const opening = executeCommand("workspace.openFolder", {}, { windowLabel: "main" });
    // Both commands are workspace transitions for the same window. Running them
    // concurrently restores tabs/split layout into whichever workspace lands
    // last — they must share one guard, not two independent keys.
    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockExists).not.toHaveBeenCalled();
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();

    resolvePicker(null);
    await opening;

    // Guard released after the first transition completes.
    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });
    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
  });

  it("does not block a workspace open in a different window", async () => {
    registerWorkspaceCommands();
    let resolvePicker!: (value: string | null) => void;
    mockOpenPicker.mockImplementation(
      () => new Promise<string | null>((resolve) => { resolvePicker = resolve; }),
    );

    const opening = executeCommand("workspace.openFolder", {}, { windowLabel: "main" });
    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "doc-1" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "doc-1" });

    resolvePicker(null);
    await opening;
  });

  it("toasts a localized error when the dirty-tab new-window IPC fails", async () => {
    useTabStore.setState({
      tabs: { main: [{ id: "t1", filePath: "/x.md" }] },
      activeTabId: { main: "t1" },
      getTabsByWindow: () => [{ id: "t1", filePath: "/x.md" }],
    } as never);
    useDocumentStore.setState({
      documents: { t1: { isDirty: true } },
      getDocument: () => ({ isDirty: true }),
    } as never);
    mockAsk.mockResolvedValue(true);
    mockInvoke.mockRejectedValue(new Error("ipc down"));

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockToastError).toHaveBeenCalled();
  });
});
