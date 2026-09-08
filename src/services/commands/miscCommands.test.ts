// @vitest-environment node
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

const mockOpenUrl = vi.fn();
const mockToastError = vi.fn();
const mockRevealItemInDir = vi.fn();
const mockMkdir = vi.fn();
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...a: unknown[]) => mockOpenUrl(...a),
  revealItemInDir: (...a: unknown[]) => mockRevealItemInDir(...a),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ mkdir: (...a: unknown[]) => mockMkdir(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...a: unknown[]) => mockToastError(...a), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => mockAsk(...a) }));
vi.mock("@/services/history/historyRecovery", () => ({
  clearAllHistory: (...a: unknown[]) => mockClearAllHistory(...a),
  clearWorkspaceHistory: (...a: unknown[]) => mockClearWorkspaceHistory(...a),
}));
vi.mock("@/utils/historyTypes", () => ({
  emitHistoryCleared: (...a: unknown[]) => mockEmitHistoryCleared(...a),
}));

import { executeCommand, listCommands, getCommand, _resetCommandBus } from "./CommandBus";
import { registerMiscCommands } from "./miscCommands";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  _resetCommandBus();
  [mockAsk, mockClearAllHistory, mockClearWorkspaceHistory, mockEmitHistoryCleared,
   mockOpenUrl, mockToastError, mockRevealItemInDir, mockMkdir, mockInvoke]
    .forEach((m) => m.mockReset());
  mockOpenUrl.mockResolvedValue(undefined);
  mockInvoke.mockResolvedValue("/genies");
  mockMkdir.mockResolvedValue(undefined);
  mockRevealItemInDir.mockResolvedValue(undefined);
  mockClearAllHistory.mockResolvedValue(undefined);
  mockClearWorkspaceHistory.mockResolvedValue(0);
  registerMiscCommands();
});

afterEach(() => _resetCommandBus());

describe("registerMiscCommands", () => {
  it("registers the 10 misc commands", () => {
    const ids = listCommands().map((c) => c.id);
    expect(ids).toEqual([
      "app.preferences",
      "app.commandPalette",
      "app.quickOpen",
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
    // Simulate Vite HMR: the registrar module re-instantiates while
    // CommandBus's REGISTRY survives. Owner registration is replace-own, so a
    // second call converges on exactly this batch rather than colliding.
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

// Audit #921 — a rejected `openUrl` used to escape the handler. The menu
// dispatcher writes such a throw to the log and the palette route drops it, so
// clicking Help did nothing at all with no way to tell it from a slow browser.
describe("help links report a refused open (#921)", () => {
  it.each(["help.vmarkHelp", "help.keyboardShortcuts", "help.reportIssue"])(
    "%s resolves and toasts when the opener refuses",
    async (id) => {
      mockOpenUrl.mockRejectedValue({ code: "unsupported", message: "no handler for https" });

      await expect(executeCommand(id, null, { windowLabel: "main" })).resolves.toBe(true);

      expect(mockOpenUrl).toHaveBeenCalledTimes(1);
      expect(mockToastError).toHaveBeenCalledWith("no handler for https");
    },
  );

  it("stays quiet when the link opens", async () => {
    await executeCommand("help.vmarkHelp", null, { windowLabel: "main" });
    expect(mockOpenUrl).toHaveBeenCalledWith("https://vmark.app/guide/");
    expect(mockToastError).not.toHaveBeenCalled();
  });
});

// Audit #922 — the SAME defect #921 fixed one command over: this handler caught
// its failure and wrote a log line, so a refusal left an interactive menu item
// visibly doing nothing. Both now go through `commandFailure`.
describe("genies.openFolder reports a refusal (#922)", () => {
  it("reveals the folder after creating it", async () => {
    await expect(
      executeCommand("genies.openFolder", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);

    expect(mockMkdir).toHaveBeenCalledWith("/genies", { recursive: true });
    expect(mockRevealItemInDir).toHaveBeenCalledWith("/genies");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("toasts when the file manager refuses to reveal it", async () => {
    mockRevealItemInDir.mockRejectedValue(new Error("no handler"));

    await expect(
      executeCommand("genies.openFolder", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);

    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it("toasts when the directory cannot be created", async () => {
    mockMkdir.mockRejectedValue(new Error("read-only volume"));

    await executeCommand("genies.openFolder", undefined, { windowLabel: "main" });

    expect(mockRevealItemInDir).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });
});
