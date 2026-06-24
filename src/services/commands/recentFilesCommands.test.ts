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

import { executeCommand, _resetCommandBus } from "./CommandBus";
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

beforeEach(() => {
  _resetCommandBus();
  __resetRecentFilesCommandsRegistration();
  [mockExists, mockAsk, mockInvoke, mockOpenFileInNewTabCore, mockReplaceTabWithFile, mockResolveOpenAction, mockToastError]
    .forEach((m) => m.mockReset());
  mockExists.mockResolvedValue(true);
  mockReplaceTabWithFile.mockResolvedValue({ ok: true });
  useRecentFilesStore.setState({ files: [{ path: "/docs/a.md" }] } as never);
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} } as never);
  registerRecentFilesCommands();
});

afterEach(() => _resetCommandBus());

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
    mockResolveOpenAction.mockReturnValue({ action: "create_tab" });
    mockExists.mockResolvedValue(true);

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/docs/a.md");
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
