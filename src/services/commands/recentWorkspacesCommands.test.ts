// @vitest-environment node
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

const mockStat = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...a: unknown[]) => mockExists(...a),
  stat: (...a: unknown[]) => mockStat(...a),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...a: unknown[]) => mockAsk(...a),
  open: (...a: unknown[]) => mockOpenPicker(...a),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));
vi.mock("@/services/workspaces/workspaceSession", () => ({
  persistWorkspaceSession: (...a: unknown[]) => mockPersistWorkspaceSession(...a),
}));
vi.mock("@/services/navigation/restoreWorkspaceTabs", () => ({
  restoreWorkspaceTabs: (...a: unknown[]) => mockRestoreWorkspaceTabs(...a),
  restoreSplitLayout: () => {},
}));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { error: (...a: unknown[]) => mockToastError(...a) } }));

import { executeCommand, listCommands, _resetCommandBus } from "./CommandBus";
import { registerRecentWorkspacesCommands } from "./recentWorkspacesCommands";
import { registerWorkspaceCommands } from "./workspaceCommands";
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
  [mockExists, mockStat, mockAsk, mockOpenPicker, mockInvoke, mockOpenWorkspaceWithConfig,
    mockRestoreWorkspaceTabs, mockToastError, mockPersistWorkspaceSession]
    .forEach((m) => m.mockReset());
  mockExists.mockResolvedValue(true);
  mockStat.mockResolvedValue({ isDirectory: true });
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

afterEach(() => _resetCommandBus());

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("re-registering the owner batch replaces it instead of throwing", () => {
    const before = listCommands().length;
    // Vite HMR re-runs the registrar module against a REGISTRY that survives.
    // `registerCommands` replaces the owner's own previous batch, which is the
    // whole idempotence guard — there is no module-level flag to reset.
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

// Audit #937 — `exists()` is true for a regular FILE, and
// `openWorkspaceWithConfig` falls back to store defaults on any read failure,
// so a file standing where the folder used to be would have been installed as
// the workspace root.
describe("workspace.openRecent requires a DIRECTORY (#937)", () => {
  it("treats a file at the recorded path as a missing workspace", async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ isDirectory: false });
    mockAsk.mockResolvedValue(true);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    expect(useRecentWorkspacesStore.getState().workspaces).toEqual([]);
  });

  it("still opens a real directory", async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ isDirectory: true });

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
  });

  it("a stat that cannot RUN keeps the older verdict: continue, do not offer removal", async () => {
    // Offering to remove a workspace that exists is the worse outcome — the
    // same reasoning the exists() probe already carries.
    mockExists.mockResolvedValue(true);
    mockStat.mockRejectedValue(new Error("forbidden path"));

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
    expect(useRecentWorkspacesStore.getState().workspaces).toEqual([{ path: "/repo" }]);
  });
});

// Audit #938 — the in-window transition is `openWorkspaceByPath`, not a local
// re-implementation of it. The copy this command used to keep had no top-level
// error boundary, so a throw from anywhere inside the sequence escaped the
// command; the shared one logs and reports "did not open" instead.
describe("workspace.openRecent delegates the accepted transition", () => {
  it("does not reject when the transition throws", async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ isDirectory: true });
    mockOpenWorkspaceWithConfig.mockRejectedValue(new Error("config unreadable"));

    await expect(
      executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" }),
    ).resolves.toBe(true);

    expect(mockRestoreWorkspaceTabs).not.toHaveBeenCalled();
  });

  it("records the workspace in recents through the shared transition", async () => {
    useRecentWorkspacesStore.setState({ workspaces: [] } as never);
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ isDirectory: true });
    mockOpenWorkspaceWithConfig.mockResolvedValue(null);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(useRecentWorkspacesStore.getState().workspaces).toContainEqual(
      expect.objectContaining({ path: "/repo" }),
    );
  });
});
