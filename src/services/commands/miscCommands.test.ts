/**
 * Tests for the misc command registrar (ADR-012).
 *
 * Covers registration invariants (full command set, HMR-safe idempotency)
 * and the destructive history-clearing command behaviors: confirmation
 * gating, workspace-scoping, and the history-cleared broadcast.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mockAsk = vi.fn();
const mockClearAllHistory = vi.fn();
const mockClearWorkspaceHistory = vi.fn();
const mockEmitHistoryCleared = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => mockAsk(...a) }));
vi.mock("@/hooks/useHistoryRecovery", () => ({
  clearAllHistory: (...a: unknown[]) => mockClearAllHistory(...a),
  clearWorkspaceHistory: (...a: unknown[]) => mockClearWorkspaceHistory(...a),
}));
vi.mock("@/utils/historyTypes", () => ({
  emitHistoryCleared: (...a: unknown[]) => mockEmitHistoryCleared(...a),
}));

import { executeCommand, listCommands, getCommand, _resetCommandBus } from "./CommandBus";
import {
  registerMiscCommands,
  __resetMiscCommandsRegistration,
} from "./miscCommands";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  _resetCommandBus();
  __resetMiscCommandsRegistration();
  [mockAsk, mockClearAllHistory, mockClearWorkspaceHistory, mockEmitHistoryCleared]
    .forEach((m) => m.mockReset());
  mockClearAllHistory.mockResolvedValue(undefined);
  mockClearWorkspaceHistory.mockResolvedValue(0);
  registerMiscCommands();
});

afterEach(() => _resetCommandBus());

describe("registerMiscCommands", () => {
  it("registers the 8 misc commands", () => {
    const ids = listCommands().map((c) => c.id);
    expect(ids).toEqual([
      "app.preferences",
      "history.clearAll",
      "history.clearWorkspace",
      "image.cleanupOrphans",
      "help.vmarkHelp",
      "help.keyboardShortcuts",
      "help.reportIssue",
      "genies.openFolder",
    ]);
  });

  it("is idempotent — a second call does not throw on duplicate ids", () => {
    expect(() => registerMiscCommands()).not.toThrow();
    expect(getCommand("app.preferences")).toBeDefined();
  });
});

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("does not throw when the module flag resets but the bus registry survives", () => {
    const before = listCommands().length;
    // Simulate Vite HMR: the registrar module re-instantiates (module-local
    // `registered` flag resets) while CommandBus's REGISTRY survives.
    __resetMiscCommandsRegistration();
    expect(() => registerMiscCommands()).not.toThrow();
    expect(listCommands().length).toBe(before);
  });
});

describe("history.clearAll (destructive)", () => {
  it("clears all history and broadcasts after the user confirms", async () => {
    mockAsk.mockResolvedValue(true);

    await executeCommand("history.clearAll", undefined, { windowLabel: "main" });

    expect(mockClearAllHistory).toHaveBeenCalledTimes(1);
    expect(mockEmitHistoryCleared).toHaveBeenCalledTimes(1);
  });

  it("does not clear when the user cancels the confirmation", async () => {
    mockAsk.mockResolvedValue(false);

    await executeCommand("history.clearAll", undefined, { windowLabel: "main" });

    expect(mockClearAllHistory).not.toHaveBeenCalled();
    expect(mockEmitHistoryCleared).not.toHaveBeenCalled();
  });

  it("does not reject when clearing fails (logged, not thrown)", async () => {
    mockAsk.mockResolvedValue(true);
    mockClearAllHistory.mockRejectedValue(new Error("fs denied"));

    await expect(
      executeCommand("history.clearAll", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
    // The failure path must not pretend history was cleared.
    expect(mockEmitHistoryCleared).not.toHaveBeenCalled();
  });
});

describe("history.clearWorkspace (destructive)", () => {
  it("does nothing when no workspace is open", async () => {
    useWorkspaceStore.setState({ rootPath: null } as never);

    await executeCommand("history.clearWorkspace", undefined, { windowLabel: "main" });

    expect(mockAsk).not.toHaveBeenCalled();
    expect(mockClearWorkspaceHistory).not.toHaveBeenCalled();
  });

  it("clears only the current workspace's history after confirmation", async () => {
    useWorkspaceStore.setState({ rootPath: "/repo" } as never);
    mockAsk.mockResolvedValue(true);
    mockClearWorkspaceHistory.mockResolvedValue(3);

    await executeCommand("history.clearWorkspace", undefined, { windowLabel: "main" });

    expect(mockClearWorkspaceHistory).toHaveBeenCalledWith("/repo");
    expect(mockEmitHistoryCleared).toHaveBeenCalledTimes(1);
  });

  it("does not clear when the user cancels the confirmation", async () => {
    useWorkspaceStore.setState({ rootPath: "/repo" } as never);
    mockAsk.mockResolvedValue(false);

    await executeCommand("history.clearWorkspace", undefined, { windowLabel: "main" });

    expect(mockClearWorkspaceHistory).not.toHaveBeenCalled();
    expect(mockEmitHistoryCleared).not.toHaveBeenCalled();
  });
});
