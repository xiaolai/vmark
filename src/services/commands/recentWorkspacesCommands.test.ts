/**
 * Tests for Open Recent Workspace command (ADR-012).
 *
 * Covers arg validation, missing-workspace removal, the dirty-tab new-window
 * flow (including IPC failure feedback), and the tab-restore path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExists = vi.fn();
const mockAsk = vi.fn();
const mockInvoke = vi.fn();
const mockOpenWorkspaceWithConfig = vi.fn();
const mockRestoreWorkspaceTabs = vi.fn();
const mockToastError = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({ exists: (...a: unknown[]) => mockExists(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => mockAsk(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));
vi.mock("@/services/navigation/restoreWorkspaceTabs", () => ({
  restoreWorkspaceTabs: (...a: unknown[]) => mockRestoreWorkspaceTabs(...a),
}));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { error: (...a: unknown[]) => mockToastError(...a) } }));

import { executeCommand, _resetCommandBus } from "./CommandBus";
import {
  registerRecentWorkspacesCommands,
  __resetRecentWorkspacesCommandsRegistration,
} from "./recentWorkspacesCommands";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

beforeEach(() => {
  _resetCommandBus();
  __resetRecentWorkspacesCommandsRegistration();
  [mockExists, mockAsk, mockInvoke, mockOpenWorkspaceWithConfig, mockRestoreWorkspaceTabs, mockToastError]
    .forEach((m) => m.mockReset());
  mockExists.mockResolvedValue(true);
  mockOpenWorkspaceWithConfig.mockResolvedValue(null);
  mockRestoreWorkspaceTabs.mockResolvedValue(0);
  mockInvoke.mockResolvedValue(undefined);
  useRecentWorkspacesStore.setState({ workspaces: [{ path: "/repo" }] } as never);
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} } as never);
  useDocumentStore.setState({ documents: {} } as never);
  registerRecentWorkspacesCommands();
});

afterEach(() => _resetCommandBus());

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
