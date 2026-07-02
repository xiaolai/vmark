/**
 * Tests for Open Recent File command branches (ADR-012).
 *
 * Covers arg parsing, and the four open actions (activate / create / replace /
 * new window) plus the missing-file, cancel, and failure paths via the exported
 * helpers and a controllable resolveOpenAction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExists = vi.fn();
const mockAsk = vi.fn();
const mockInvoke = vi.fn();
const mockOpenFileInNewTabCore = vi.fn();
const mockReplaceTabWithFile = vi.fn();
const mockResolveOpenAction = vi.fn();
const mockToastError = vi.fn();
const mockOpenWorkspaceWithConfig = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({ exists: (...a: unknown[]) => mockExists(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => mockAsk(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@/hooks/useFileOpen", () => ({
  openFileInNewTabCore: (...a: unknown[]) => mockOpenFileInNewTabCore(...a),
  replaceTabWithFile: (...a: unknown[]) => mockReplaceTabWithFile(...a),
}));
vi.mock("@/utils/openPolicy", () => ({
  resolveOpenAction: (...a: unknown[]) => mockResolveOpenAction(...a),
}));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { error: (...a: unknown[]) => mockToastError(...a) } }));
vi.mock("@/hooks/useReplaceableTab", () => ({ getReplaceableTab: () => null }));
vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));

import { executeCommand, listCommands, _resetCommandBus } from "./CommandBus";
import {
  parseRecentFileArgs,
  openRecentInNewTab,
  replaceTabWithRecentFile,
  openRecentInNewWindow,
  registerRecentFilesCommands,
  __resetRecentFilesCommandsRegistration,
} from "./recentFilesCommands";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";

beforeEach(() => {
  _resetCommandBus();
  __resetRecentFilesCommandsRegistration();
  [mockExists, mockAsk, mockInvoke, mockOpenFileInNewTabCore, mockReplaceTabWithFile, mockResolveOpenAction, mockToastError, mockOpenWorkspaceWithConfig]
    .forEach((m) => m.mockReset());
  mockExists.mockResolvedValue(true);
  mockReplaceTabWithFile.mockResolvedValue({ ok: true });
  useRecentFilesStore.setState({ files: [{ path: "/docs/a.md" }] } as never);
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} } as never);
  useSettingsStore.setState((s) => ({ general: { ...s.general, openInNewTab: false } }));
  registerRecentFilesCommands();
});

afterEach(() => _resetCommandBus());

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("does not throw when the module flag resets but the bus registry survives", () => {
    const before = listCommands().length;
    // Simulate Vite HMR: the registrar module re-instantiates (module-local
    // `registered` flag resets) while CommandBus's REGISTRY survives.
    __resetRecentFilesCommandsRegistration();
    expect(() => registerRecentFilesCommands()).not.toThrow();
    expect(listCommands().length).toBe(before);
  });
});

describe("parseRecentFileArgs", () => {
  it.each([
    [["/docs/a.md", "a.md"], "/docs/a.md"],
    ["/docs/b.md", "/docs/b.md"],
    [[], null],
    [[null], null],
    [null, null],
    [undefined, null],
    ["", null],
    [42, null],
  ])("args=%j → %j", (args, expected) => {
    expect(parseRecentFileArgs(args)).toBe(expected);
  });
});

describe("openRecentInNewTab", () => {
  it("opens an existing file", async () => {
    mockExists.mockResolvedValue(true);
    await openRecentInNewTab("main", "/docs/a.md");
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/docs/a.md");
  });

  it("prompts to remove a missing recent file and removes it on confirm", async () => {
    mockExists.mockResolvedValue(false);
    mockAsk.mockResolvedValue(true);
    await openRecentInNewTab("main", "/docs/a.md");
    expect(mockOpenFileInNewTabCore).not.toHaveBeenCalled();
    expect(useRecentFilesStore.getState().files).toEqual([]);
  });

  it("keeps the missing file when the user declines removal", async () => {
    mockExists.mockResolvedValue(false);
    mockAsk.mockResolvedValue(false);
    await openRecentInNewTab("main", "/docs/a.md");
    expect(useRecentFilesStore.getState().files).toEqual([{ path: "/docs/a.md" }]);
  });
});

describe("replaceTabWithRecentFile", () => {
  const params = { windowLabel: "main", tabId: "t1", targetPath: "/docs/a.md", sourcePath: "/docs/a.md" };

  it("does nothing extra on success", async () => {
    mockReplaceTabWithFile.mockResolvedValue({ ok: true });
    await replaceTabWithRecentFile(params);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("does nothing extra when cancelled", async () => {
    mockReplaceTabWithFile.mockResolvedValue({ ok: false, cancelled: true });
    await replaceTabWithRecentFile(params);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("offers removal on read failure and removes on confirm", async () => {
    mockReplaceTabWithFile.mockResolvedValue({ ok: false, cancelled: false, error: new Error("boom") });
    mockAsk.mockResolvedValue(true);
    await replaceTabWithRecentFile(params);
    expect(useRecentFilesStore.getState().files).toEqual([]);
  });
});

describe("openRecentInNewWindow", () => {
  it("invokes the new-window command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await openRecentInNewWindow("/repo", "/repo/a.md");
    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/repo",
      filePath: "/repo/a.md",
    });
  });

  it("toasts a localized error when the invoke fails", async () => {
    mockInvoke.mockRejectedValue(new Error("nope"));
    await openRecentInNewWindow("/repo", "/repo/a.md");
    expect(mockToastError).toHaveBeenCalled();
  });
});

describe("file.openRecent command dispatch", () => {
  it("rejects non-string args without resolving an action", async () => {
    await executeCommand("file.openRecent", [], { windowLabel: "main" });
    expect(mockResolveOpenAction).not.toHaveBeenCalled();
  });

  it("activate_tab activates the existing tab", async () => {
    const setActiveTab = vi.fn();
    useTabStore.setState({
      tabs: { main: [{ id: "t1", filePath: "/docs/a.md" }] },
      activeTabId: {},
      findTabByPath: () => ({ id: "t1" }),
      setActiveTab,
    } as never);
    mockResolveOpenAction.mockReturnValue({ action: "activate_tab", tabId: "t1" });

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });
    expect(setActiveTab).toHaveBeenCalledWith("main", "t1");
  });

  it("create_tab routes through openRecentInNewTab", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({ action: "create_tab", filePath: "/docs/a.md" });
    mockExists.mockResolvedValue(true);

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/docs/a.md");
    // In-workspace / rail-mode opens carry no workspaceRoot — stay in context.
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("create_tab with a resolved workspaceRoot opens that workspace first (#946 parity with Cmd+O)", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "create_tab", filePath: "/ext/a.md", workspaceRoot: "/ext",
    });
    mockExists.mockResolvedValue(true);
    mockOpenWorkspaceWithConfig.mockResolvedValue(null);

    await executeCommand("file.openRecent", "/ext/a.md", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/ext", { windowLabel: "main" });
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/ext/a.md");
    // Workspace ownership must be claimed BEFORE the tab is created.
    expect(mockOpenWorkspaceWithConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockOpenFileInNewTabCore.mock.invocationCallOrder[0],
    );
  });

  it("create_tab still opens the tab when claiming the workspace fails", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "create_tab", filePath: "/ext/a.md", workspaceRoot: "/ext",
    });
    mockExists.mockResolvedValue(true);
    mockOpenWorkspaceWithConfig.mockRejectedValue(new Error("config unreadable"));

    await executeCommand("file.openRecent", "/ext/a.md", { windowLabel: "main" });

    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/ext/a.md");
  });

  it("replace_tab routes through the shared replace helper", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab", tabId: "t1", filePath: "/docs/a.md", workspaceRoot: null,
    });

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });
    expect(mockReplaceTabWithFile).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: "t1", sourcePath: "/docs/a.md" }),
    );
  });

  it("open_workspace_in_new_window invokes the command", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "open_workspace_in_new_window", workspaceRoot: "/repo", filePath: "/repo/a.md",
    });
    mockInvoke.mockResolvedValue(undefined);

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });
    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/repo",
      filePath: "/repo/a.md",
    });
  });
});

describe("file.openRecent honors general.openInNewTab (parity with Cmd+O)", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({ action: "no_op", reason: "test" });
  });

  it.each([[true], [false]])(
    "passes openInNewTab=%s from settings into resolveOpenAction",
    async (openInNewTab) => {
      useSettingsStore.setState((s) => ({ general: { ...s.general, openInNewTab } }));

      await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

      expect(mockResolveOpenAction).toHaveBeenCalledWith(
        expect.objectContaining({ openInNewTab }),
      );
    },
  );
});

describe("file.clearRecent", () => {
  it("does nothing when the recents list is empty", async () => {
    useRecentFilesStore.setState({ files: [] } as never);

    await executeCommand("file.clearRecent", undefined, { windowLabel: "main" });

    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("clears the list after the user confirms", async () => {
    mockAsk.mockResolvedValue(true);

    await executeCommand("file.clearRecent", undefined, { windowLabel: "main" });

    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(useRecentFilesStore.getState().files).toEqual([]);
  });

  it("keeps the list when the user cancels", async () => {
    mockAsk.mockResolvedValue(false);

    await executeCommand("file.clearRecent", undefined, { windowLabel: "main" });

    expect(useRecentFilesStore.getState().files).toEqual([{ path: "/docs/a.md" }]);
  });
});
