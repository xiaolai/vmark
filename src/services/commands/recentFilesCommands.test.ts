// @vitest-environment node
/**
 * Tests for Open Recent File command branches (ADR-012).
 *
 * Covers arg parsing, the recents PREFLIGHT (missing / probe-refused /
 * directory), and the four open actions (activate / create / replace / new
 * window) as they are carried out by the SHARED executor — the copy this
 * command used to keep of its own (audit #930) is gone, and these assert the
 * two behaviours that copy had drifted on: ownership-aware activation (#931)
 * and a visible warning when the workspace claim fails (#932).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExists = vi.fn();
const mockStat = vi.fn();
const mockAsk = vi.fn();
const mockInvoke = vi.fn();
const mockOpenFileInNewTabCore = vi.fn();
const mockReplaceTabWithFile = vi.fn();
const mockResolveOpenAction = vi.fn();
const mockToastError = vi.fn();
const mockToastErrorDetail = vi.fn();
const mockToastWarning = vi.fn();
const mockOpenWorkspaceWithConfig = vi.fn();
const mockIsWindowEmpty = vi.fn<(windowLabel: string) => boolean>(() => false);

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...a: unknown[]) => mockExists(...a),
  stat: (...a: unknown[]) => mockStat(...a),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => mockAsk(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@/services/navigation/fileOpen", () => ({
  openFileInNewTabCore: (...a: unknown[]) => mockOpenFileInNewTabCore(...a),
}));
// executeOpenDecision reaches the replace helper directly, not through
// fileOpen's re-export.
vi.mock("@/services/navigation/replaceTabWithFile", () => ({
  replaceTabWithFile: (...a: unknown[]) => mockReplaceTabWithFile(...a),
}));
vi.mock("@/utils/openPolicy", () => ({
  resolveOpenAction: (...a: unknown[]) => mockResolveOpenAction(...a),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    error: (...a: unknown[]) => mockToastError(...a),
    errorDetail: (...a: unknown[]) => mockToastErrorDetail(...a),
    warning: (...a: unknown[]) => mockToastWarning(...a),
  },
}));
vi.mock("@/services/tabs/replaceableTab", () => ({
  getReplaceableTab: () => null,
  isWindowEmpty: (windowLabel: string) => mockIsWindowEmpty(windowLabel),
}));
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));

import { executeCommand, listCommands, _resetCommandBus } from "./CommandBus";
import { parseRecentFileArgs, registerRecentFilesCommands } from "./recentFilesCommands";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";

/** Give the window one tab so ownership-aware activation can find it. */
function seedTab(setActiveTab = vi.fn()): typeof setActiveTab {
  useTabStore.setState({
    tabs: { main: [{ id: "t1", kind: "document", filePath: "/docs/a.md" }] },
    activeTabId: {},
    findTabByPath: () => ({ id: "t1" }),
    setActiveTab,
  } as never);
  return setActiveTab;
}

beforeEach(() => {
  _resetCommandBus();
  [mockExists, mockStat, mockAsk, mockInvoke, mockOpenFileInNewTabCore, mockReplaceTabWithFile,
    mockResolveOpenAction, mockToastError, mockToastErrorDetail, mockToastWarning,
    mockOpenWorkspaceWithConfig]
    .forEach((m) => m.mockReset());
  mockExists.mockResolvedValue(true);
  mockStat.mockResolvedValue({ isFile: true });
  mockReplaceTabWithFile.mockResolvedValue({ ok: true });
  mockOpenFileInNewTabCore.mockResolvedValue("opened");
  useRecentFilesStore.setState({ files: [{ path: "/docs/a.md" }] } as never);
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} } as never);
  useSettingsStore.setState((s) => ({ general: { ...s.general, openInNewTab: false } }));
  registerRecentFilesCommands();
});

afterEach(() => _resetCommandBus());

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("re-registering the owner batch replaces it instead of throwing", () => {
    const before = listCommands().length;
    // Vite HMR re-runs the registrar against a REGISTRY that survives.
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

// The preflight is the one thing the shared executor cannot ask (#926/#928).
describe("stale-entry preflight", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({ action: "create_tab", filePath: "/docs/a.md" });
  });

  it("prompts to remove a missing recent file and removes it on confirm", async () => {
    mockExists.mockResolvedValue(false);
    mockAsk.mockResolvedValue(true);

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

    expect(mockOpenFileInNewTabCore).not.toHaveBeenCalled();
    expect(useRecentFilesStore.getState().files).toEqual([]);
  });

  it("keeps the missing file when the user declines removal", async () => {
    mockExists.mockResolvedValue(false);
    mockAsk.mockResolvedValue(false);

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

    expect(useRecentFilesStore.getState().files).toEqual([{ path: "/docs/a.md" }]);
  });

  it("treats a directory standing where the file was as gone", async () => {
    mockStat.mockResolvedValue({ isFile: false });
    mockAsk.mockResolvedValue(true);

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

    expect(mockOpenFileInNewTabCore).not.toHaveBeenCalled();
    expect(useRecentFilesStore.getState().files).toEqual([]);
  });

  // #1252's class for files: `exists()` REJECTS for a path outside the fs
  // scope. That rejection used to escape the command — the menu item did
  // nothing, with no message — and a probe that could not run is not evidence
  // the file is gone.
  it("opens anyway when the probe itself fails, and never offers removal", async () => {
    mockExists.mockRejectedValue(new Error("forbidden path"));

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

    expect(mockAsk).not.toHaveBeenCalled();
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/docs/a.md");
    expect(useRecentFilesStore.getState().files).toEqual([{ path: "/docs/a.md" }]);
  });

  it("does not probe for an activate_tab decision", async () => {
    seedTab();
    mockResolveOpenAction.mockReturnValue({ action: "activate_tab", tabId: "t1" });

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

    expect(mockExists).not.toHaveBeenCalled();
  });

  // #928 — the new-window route used to skip cleanup entirely, so the same
  // dead entry was removable from two routes and immortal in the third.
  it("offers removal on the new-window route too", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "open_workspace_in_new_window", workspaceRoot: "/repo", filePath: "/docs/a.md",
    });
    mockExists.mockResolvedValue(false);
    mockAsk.mockResolvedValue(true);

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

    expect(mockInvoke).not.toHaveBeenCalledWith(
      "open_workspace_in_new_window",
      expect.anything(),
    );
    expect(useRecentFilesStore.getState().files).toEqual([]);
  });
});

describe("file.openRecent command dispatch", () => {
  it("rejects non-string args without resolving an action", async () => {
    await executeCommand("file.openRecent", [], { windowLabel: "main" });
    expect(mockResolveOpenAction).not.toHaveBeenCalled();
  });

  // #931 — activation goes through the ownership-aware path, so the sidebar
  // follows the document instead of staying on another workspace.
  it("activate_tab activates the existing tab", async () => {
    const setActiveTab = seedTab();
    mockResolveOpenAction.mockReturnValue({ action: "activate_tab", tabId: "t1" });

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });
    expect(setActiveTab).toHaveBeenCalledWith("main", "t1");
  });

  it("activate_tab does nothing for a tab this window does not have", async () => {
    const setActiveTab = vi.fn();
    useTabStore.setState({
      tabs: { main: [] }, activeTabId: {}, findTabByPath: () => ({ id: "gone" }), setActiveTab,
    } as never);
    mockResolveOpenAction.mockReturnValue({ action: "activate_tab", tabId: "gone" });

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it("create_tab opens the file", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({ action: "create_tab", filePath: "/docs/a.md" });

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
    mockOpenWorkspaceWithConfig.mockResolvedValue(null);

    await executeCommand("file.openRecent", "/ext/a.md", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/ext", { windowLabel: "main" });
    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/ext/a.md");
    // Workspace ownership must be claimed BEFORE the tab is created.
    expect(mockOpenWorkspaceWithConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockOpenFileInNewTabCore.mock.invocationCallOrder[0],
    );
  });

  // #932 — the drift that mattered: recents LOGGED the failed claim, so the
  // file opened under the previous workspace with nothing on screen to say so.
  it("create_tab still opens the tab when claiming the workspace fails, and warns", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "create_tab", filePath: "/ext/a.md", workspaceRoot: "/ext",
    });
    mockOpenWorkspaceWithConfig.mockRejectedValue(new Error("config unreadable"));

    await executeCommand("file.openRecent", "/ext/a.md", { windowLabel: "main" });

    expect(mockOpenFileInNewTabCore).toHaveBeenCalledWith("main", "/ext/a.md");
    expect(mockToastWarning).toHaveBeenCalled();
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

  // #927 — a replace that fails for a reason OTHER than absence (ingestion,
  // ownership, a workspace switch) is reported as the failure it is. It used
  // to be presented as "file not found" with an offer to delete the entry.
  it("replace_tab reports a post-preflight failure instead of offering removal", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab", tabId: "t1", filePath: "/docs/a.md", workspaceRoot: null,
    });
    mockReplaceTabWithFile.mockResolvedValue({ ok: false, cancelled: false, error: new Error("boom") });

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

    expect(mockToastErrorDetail).toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
    expect(useRecentFilesStore.getState().files).toEqual([{ path: "/docs/a.md" }]);
  });

  it("replace_tab stays quiet when the user cancelled", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab", tabId: "t1", filePath: "/docs/a.md", workspaceRoot: null,
    });
    mockReplaceTabWithFile.mockResolvedValue({ ok: false, cancelled: true });

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

    expect(mockToastErrorDetail).not.toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
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

  it("open_workspace_in_new_window toasts a localized error when the invoke fails", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({
      action: "open_workspace_in_new_window", workspaceRoot: "/repo", filePath: "/repo/a.md",
    });
    mockInvoke.mockRejectedValue(new Error("nope"));

    await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });
    expect(mockToastError).toHaveBeenCalled();
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

// fix(#1331) — the Welcome screen's recent list dispatches this command from a
// window with ZERO tabs. Without the signal the policy saw "no replaceable tab"
// and opened a new window, leaving the clicked-in window empty.
describe("file.openRecent forwards the empty-window signal (parity with Cmd+O)", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, findTabByPath: () => null } as never);
    mockResolveOpenAction.mockReturnValue({ action: "no_op", reason: "test" });
  });

  it.each([[true], [false]])(
    "passes windowIsEmpty=%s into resolveOpenAction",
    async (windowIsEmpty) => {
      mockIsWindowEmpty.mockReturnValue(windowIsEmpty);

      await executeCommand("file.openRecent", "/docs/a.md", { windowLabel: "main" });

      expect(mockIsWindowEmpty).toHaveBeenCalledWith("main");
      expect(mockResolveOpenAction).toHaveBeenCalledWith(
        expect.objectContaining({ windowIsEmpty }),
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
