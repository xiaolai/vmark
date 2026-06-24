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

vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn() }));

import { executeCommand, _resetCommandBus } from "./CommandBus";
import {
  registerWorkspaceCommands,
  __resetWorkspaceCommandsRegistration,
} from "./workspaceCommands";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";

beforeEach(() => {
  _resetCommandBus();
  __resetWorkspaceCommandsRegistration();
  mockOpenPicker.mockReset();
  mockAsk.mockReset();
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
});
