/**
 * Tests for useFileOpen utilities
 *
 * Tests openFileInNewTabCore, openFileInNewTab, handleOpenFile, handleNew.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockReadTextFile = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));

const mockOpen = vi.fn();
const mockAsk = vi.fn(() => Promise.resolve(true));
const mockMessage = vi.fn(() => Promise.resolve(undefined));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
  ask: (...args: unknown[]) => mockAsk(...args),
  message: (...args: unknown[]) => mockMessage(...args),
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/utils/perfLog", () => ({
  perfReset: vi.fn(),
  perfStart: vi.fn(),
  perfEnd: vi.fn(),
  perfMark: vi.fn(),
}));

vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: () => ({ kind: "lf" }),
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: vi.fn(
    async (_wl: string, _key: string, fn: () => Promise<void>) => fn()
  ),
}));

const mockResolveOpenAction = vi.fn();
vi.mock("@/utils/openPolicy", () => ({
  resolveOpenAction: (...args: unknown[]) => mockResolveOpenAction(...args),
}));

const mockOpenWorkspaceWithConfig = vi.fn();
vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...args: unknown[]) => mockOpenWorkspaceWithConfig(...args),
}));

const mockGetReplaceableTab = vi.fn(() => null);
const mockFindExistingTabForPath = vi.fn(() => null);
vi.mock("@/hooks/useReplaceableTab", () => ({
  getReplaceableTab: (...args: unknown[]) => mockGetReplaceableTab(...args),
  findExistingTabForPath: (...args: unknown[]) => mockFindExistingTabForPath(...args),
}));

const mockCreateUntitledTab = vi.fn();
vi.mock("@/utils/newFile", () => ({
  createUntitledTab: (...args: unknown[]) => mockCreateUntitledTab(...args),
}));

import {
  openFileInNewTabCore,
  openFileInNewTab,
  handleOpenFile,
  handleNew,
} from "./useFileOpen";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";

const WINDOW = "main";

describe("openFileInNewTabCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset stores
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
  });

  it("creates a tab, reads file, and initializes document", async () => {
    mockReadTextFile.mockResolvedValue("# Hello");
    const initDocSpy = vi.spyOn(useDocumentStore.getState(), "initDocument");
    const addFileSpy = vi.spyOn(useRecentFilesStore.getState(), "addFile");

    await openFileInNewTabCore(WINDOW, "/docs/hello.md");

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/hello.md");
    expect(initDocSpy).toHaveBeenCalled();
    expect(addFileSpy).toHaveBeenCalledWith("/docs/hello.md");
  });

  it("cleans up orphaned tab on read failure", async () => {
    mockReadTextFile.mockRejectedValue(new Error("ENOENT"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const tabsBefore = useTabStore.getState().getTabsByWindow(WINDOW).length;
    await openFileInNewTabCore(WINDOW, "/docs/missing.md");
    const tabsAfter = useTabStore.getState().getTabsByWindow(WINDOW).length;

    // Tab should be cleaned up (detached)
    expect(tabsAfter).toBe(tabsBefore);
    errorSpy.mockRestore();
  });

  it("skips content loading when tab is deduped", async () => {
    // Create a tab first for the same path
    useTabStore.getState().createTab(WINDOW, "/docs/existing.md");

    await openFileInNewTabCore(WINDOW, "/docs/existing.md");

    // Should not read the file since it was deduped
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });
});

describe("openFileInNewTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
  });

  it("activates existing tab if file already open", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/docs/open.md");
    mockFindExistingTabForPath.mockReturnValue(tabId);
    const setActiveSpy = vi.spyOn(useTabStore.getState(), "setActiveTab");

    await openFileInNewTab(WINDOW, "/docs/open.md");

    expect(setActiveSpy).toHaveBeenCalledWith(WINDOW, tabId);
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("creates new tab when no existing tab found", async () => {
    mockFindExistingTabForPath.mockReturnValue(null);
    mockReadTextFile.mockResolvedValue("content");

    await openFileInNewTab(WINDOW, "/docs/new.md");

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/new.md");
  });
});

describe("handleOpenFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTabStore.getState().removeWindow(WINDOW);
  });

  it("activates existing tab if found", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/docs/file.md");
    mockFindExistingTabForPath.mockReturnValue(tabId);
    const setActiveSpy = vi.spyOn(useTabStore.getState(), "setActiveTab");

    await handleOpenFile(WINDOW, "/docs/file.md");

    expect(setActiveSpy).toHaveBeenCalledWith(WINDOW, tabId);
  });

  it("opens in new tab when no existing tab", async () => {
    mockFindExistingTabForPath.mockReturnValue(null);
    mockReadTextFile.mockResolvedValue("# Content");

    await handleOpenFile(WINDOW, "/docs/new.md");

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/new.md");
  });
});

describe("handleNew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an untitled tab", () => {
    handleNew(WINDOW);
    expect(mockCreateUntitledTab).toHaveBeenCalledWith(WINDOW);
  });

  it("can be called multiple times for multiple new tabs", () => {
    handleNew(WINDOW);
    handleNew(WINDOW);
    expect(mockCreateUntitledTab).toHaveBeenCalledTimes(2);
  });
});

describe("openFileInNewTabCore — edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
  });

  it("shows toast error with file path on read failure", async () => {
    mockReadTextFile.mockRejectedValue(new Error("Permission denied"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await openFileInNewTabCore(WINDOW, "/protected/secret.md");

    const { toast } = await import("sonner");
    // Pin: file-open errors carry system messages users may want to read.
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Permission denied"),
      expect.objectContaining({ action: expect.any(Object) }),
    );
    errorSpy.mockRestore();
  });

  it("handles non-Error rejection", async () => {
    mockReadTextFile.mockRejectedValue("string error");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await openFileInNewTabCore(WINDOW, "/docs/fail.md");

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("string error"),
      expect.objectContaining({ action: expect.any(Object) }),
    );
    errorSpy.mockRestore();
  });

  it("detects and stores linebreak metadata", async () => {
    mockReadTextFile.mockResolvedValue("line1\r\nline2\r\n");
    const setLineSpy = vi.spyOn(useDocumentStore.getState(), "setLineMetadata");

    await openFileInNewTabCore(WINDOW, "/docs/crlf.md");

    expect(setLineSpy).toHaveBeenCalled();
  });
});

describe("handleOpenFile — edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTabStore.getState().removeWindow(WINDOW);
  });

  it("opens file when no tabs exist at all", async () => {
    mockFindExistingTabForPath.mockReturnValue(null);
    mockReadTextFile.mockResolvedValue("# New");

    await handleOpenFile(WINDOW, "/docs/fresh.md");

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/fresh.md");
  });
});

describe("handleOpen — dialog and routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
  });

  it("does nothing when dialog is cancelled (no path selected)", async () => {
    mockOpen.mockResolvedValue(null);

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(mockResolveOpenAction).not.toHaveBeenCalled();
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("activates existing tab when action is activate_tab", async () => {
    mockOpen.mockResolvedValue("/docs/existing.md");
    mockResolveOpenAction.mockReturnValue({ action: "activate_tab", tabId: "tab-42" });
    const setActiveSpy = vi.spyOn(useTabStore.getState(), "setActiveTab");

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(setActiveSpy).toHaveBeenCalledWith(WINDOW, "tab-42");
  });

  it("creates new tab when action is create_tab", async () => {
    mockOpen.mockResolvedValue("/docs/new.md");
    mockFindExistingTabForPath.mockReturnValue(null);
    mockResolveOpenAction.mockReturnValue({ action: "create_tab" });
    mockReadTextFile.mockResolvedValue("# New Content");

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/new.md");
  });

  it("replaces tab when action is replace_tab", async () => {
    mockOpen.mockResolvedValue("/docs/replace.md");
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab",
      tabId: "empty-tab",
      filePath: "/docs/replace.md",
      workspaceRoot: "/docs",
    });
    mockReadTextFile.mockResolvedValue("# Replaced");

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/replace.md");
    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/docs");
  });

  it("handles replace_tab read failure gracefully", async () => {
    mockOpen.mockResolvedValue("/docs/broken.md");
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab",
      tabId: "empty-tab",
      filePath: "/docs/broken.md",
      workspaceRoot: "/docs",
    });
    mockReadTextFile.mockRejectedValue(new Error("read fail"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("replace_tab route refuses huge files and never reads", async () => {
    mockOpen.mockResolvedValue("/docs/huge.md");
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab",
      tabId: "empty-tab",
      filePath: "/docs/huge.md",
      workspaceRoot: "/docs",
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(60 * 1024 * 1024);
      return Promise.resolve();
    });

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(mockReadTextFile).not.toHaveBeenCalled();
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("replace_tab route sets the indeterminate indicator for ≥ 300 KB WYSIWYG opens", async () => {
    mockOpen.mockResolvedValue("/docs/medium.md");
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab",
      tabId: "empty-tab-medium",
      filePath: "/docs/medium.md",
      workspaceRoot: "/docs",
    });
    mockInvoke.mockImplementation((cmd: string) => {
      // 400 KB: above progress threshold (300 KB) but below source-mode (1 MB).
      if (cmd === "get_file_size_bytes") return Promise.resolve(400 * 1024);
      return Promise.resolve();
    });
    mockReadTextFile.mockResolvedValue("# medium");
    const { useFileLoadStore } = await import("@/stores/fileLoadStore");
    useFileLoadStore.getState().endLoad();

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    // No editor mount in the unit test, so the indicator stays active
    // until a caller (test or editor) invokes endLoad.
    expect(useFileLoadStore.getState().active).toBe(true);
  });

  it("replace_tab read failure clears the indicator (≥ 300 KB file)", async () => {
    mockOpen.mockResolvedValue("/docs/medium-fail.md");
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab",
      tabId: "empty-tab-mf",
      filePath: "/docs/medium-fail.md",
      workspaceRoot: "/docs",
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(400 * 1024);
      return Promise.resolve();
    });
    mockReadTextFile.mockRejectedValue(new Error("ENOENT"));
    const { useFileLoadStore } = await import("@/stores/fileLoadStore");
    useFileLoadStore.getState().endLoad();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    // The indicator was set at the start of replace_tab, and the error path
    // clears it via endLoad(replaceLoadId).
    expect(useFileLoadStore.getState().active).toBe(false);
    errorSpy.mockRestore();
  });

  it("replace_tab route marks large files as forced-source", async () => {
    mockOpen.mockResolvedValue("/docs/large.md");
    mockResolveOpenAction.mockReturnValue({
      action: "replace_tab",
      tabId: "empty-tab-large",
      filePath: "/docs/large.md",
      workspaceRoot: "/docs",
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(2 * 1024 * 1024);
      return Promise.resolve();
    });
    mockReadTextFile.mockResolvedValue("# large");
    const { useLargeFileSessionStore } = await import(
      "@/stores/largeFileSessionStore"
    );
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/large.md");
    expect(
      useLargeFileSessionStore.getState().isForcedSource("empty-tab-large")
    ).toBe(true);
  });

  it("opens workspace in new window when action is open_workspace_in_new_window", async () => {
    mockOpen.mockResolvedValue("/other/file.md");
    mockResolveOpenAction.mockReturnValue({
      action: "open_workspace_in_new_window",
      workspaceRoot: "/other",
      filePath: "/other/file.md",
    });

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/other",
      filePath: "/other/file.md",
    });
  });

  it("handles open_workspace_in_new_window invoke failure", async () => {
    mockOpen.mockResolvedValue("/other/file.md");
    mockResolveOpenAction.mockReturnValue({
      action: "open_workspace_in_new_window",
      workspaceRoot: "/other",
      filePath: "/other/file.md",
    });
    mockInvoke.mockRejectedValue(new Error("invoke fail"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does nothing when action is no_op", async () => {
    mockOpen.mockResolvedValue("/docs/noop.md");
    mockResolveOpenAction.mockReturnValue({ action: "no_op" });

    const { handleOpen } = await import("./useFileOpen");
    await handleOpen(WINDOW);

    expect(mockReadTextFile).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("openFileInNewTabCore — size-tier routing", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
    // Reset largeFile settings to defaults
    const { useSettingsStore } = await import("@/stores/settingsStore");
    useSettingsStore.getState().resetSettings();
    const { useLargeFileSessionStore } = await import(
      "@/stores/largeFileSessionStore"
    );
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
  });

  it("small files still open normally through WYSIWYG", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(10_000);
      return Promise.resolve();
    });
    mockReadTextFile.mockResolvedValue("# small");

    await openFileInNewTabCore(WINDOW, "/docs/small.md");
    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/small.md");
  });

  it("medium WYSIWYG files (≥ 300 KB, < 1 MB) set the load indicator", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(400 * 1024);
      return Promise.resolve();
    });
    mockReadTextFile.mockResolvedValue("# medium");
    const { useFileLoadStore } = await import("@/stores/fileLoadStore");
    useFileLoadStore.getState().endLoad();

    await openFileInNewTabCore(WINDOW, "/docs/medium.md");

    expect(useFileLoadStore.getState().active).toBe(true);
  });

  it("refused files (≥ 50 MB) never read or create a document", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(60 * 1024 * 1024);
      return Promise.resolve();
    });
    const initDocSpy = vi.spyOn(useDocumentStore.getState(), "initDocument");

    await openFileInNewTabCore(WINDOW, "/docs/huge.md");

    expect(mockReadTextFile).not.toHaveBeenCalled();
    expect(initDocSpy).not.toHaveBeenCalled();
  });

  it("large files (≥ 1 MB) still read and open in force-source mode", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(2 * 1024 * 1024);
      return Promise.resolve();
    });
    mockReadTextFile.mockResolvedValue("# large");
    const initDocSpy = vi.spyOn(useDocumentStore.getState(), "initDocument");

    await openFileInNewTabCore(WINDOW, "/docs/large.md");

    expect(mockReadTextFile).toHaveBeenCalled();
    expect(initDocSpy).toHaveBeenCalled();
    // Force-source is asserted via the session store being non-empty.
    const { useLargeFileSessionStore } = await import(
      "@/stores/largeFileSessionStore"
    );
    const marks = Object.keys(useLargeFileSessionStore.getState().forcedSourceTabs);
    expect(marks.length).toBeGreaterThan(0);
  });
});
