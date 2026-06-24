import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore, useFileLoadStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { openDroppedPathsInLegacyWindows } from "./dragDropLegacyWindows";
import { openDroppedFileInNewTab } from "./dragDropOpenFile";

const {
  mockApplyFileOwnershipAfterOpen,
  mockFindExistingTabForPath,
  mockInvoke,
  mockReadTextFile,
  mockRouteOpenBySize,
  mockToastError,
} = vi.hoisted(() => ({
  mockApplyFileOwnershipAfterOpen: vi.fn(),
  mockFindExistingTabForPath: vi.fn(() => null),
  mockInvoke: vi.fn(),
  mockReadTextFile: vi.fn(),
  mockRouteOpenBySize: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));
vi.mock("@/hooks/useReplaceableTab", () => ({
  findExistingTabForPath: (...args: unknown[]) => mockFindExistingTabForPath(...args),
}));
vi.mock("@/services/navigation/largeFileRouting", () => ({
  routeOpenBySize: (...args: unknown[]) => mockRouteOpenBySize(...args),
}));
vi.mock("@/services/workspaces/fileOwnership", () => ({
  applyFileOwnershipAfterOpen: (...args: unknown[]) =>
    mockApplyFileOwnershipAfterOpen(...args),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));
vi.mock("@/i18n", () => ({
  default: { t: (key: string, values?: unknown) => ({ key, values }) },
}));
vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: () => ({ kind: "lf" }),
}));

const WINDOW = "main";

describe("drag-drop split helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindExistingTabForPath.mockReturnValue(null);
    mockInvoke.mockResolvedValue(null);
    mockReadTextFile.mockResolvedValue("# content");
    mockRouteOpenBySize.mockResolvedValue({
      proceed: true,
      forceSourceMode: false,
      sizeBytes: 10_000,
    });
    useTabStore.setState({ tabs: {}, activeTabId: {}, closedTabs: {}, untitledCounter: 0 });
    useDocumentStore.setState({ documents: {} });
    useFileLoadStore.getState().endLoad();
    useRecentFilesStore.setState({ recentFiles: [] });
  });

  it("groups dropped files by parent workspace in legacy window mode", async () => {
    await openDroppedPathsInLegacyWindows([
      "/repo/a.md",
      "/repo/b.md",
      "/root.md",
    ]);

    expect(mockInvoke).toHaveBeenCalledWith(
      "open_workspace_with_files_in_new_window",
      { workspaceRoot: "/repo", filePaths: ["/repo/a.md", "/repo/b.md"] },
    );
    expect(mockInvoke).toHaveBeenCalledWith(
      "open_file_in_new_window",
      { path: "/root.md" },
    );
  });

  it("reports workspace and rootless legacy window open failures", async () => {
    mockInvoke.mockRejectedValue(new Error("denied"));

    await openDroppedPathsInLegacyWindows(["/repo/a.md", "/"]);

    expect(mockToastError).toHaveBeenCalledWith({
      key: "dialog:toast.failedToOpenFilesInNewWindow",
      values: undefined,
    });
    expect(mockToastError).toHaveBeenCalledWith({
      key: "dialog:toast.failedToOpen",
      values: { filename: "/" },
    });
  });

  it("activates an existing tab without reading the file again", async () => {
    const existingTabId = useTabStore.getState().createTab(WINDOW, "/repo/a.md");
    mockFindExistingTabForPath.mockReturnValue(existingTabId);

    await openDroppedFileInNewTab(WINDOW, "/repo/a.md");

    expect(useTabStore.getState().activeTabId[WINDOW]).toBe(existingTabId);
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("skips file reads when the size route refuses the open", async () => {
    mockRouteOpenBySize.mockResolvedValue({
      proceed: false,
      forceSourceMode: false,
      sizeBytes: 60 * 1024 * 1024,
    });

    await openDroppedFileInNewTab(WINDOW, "/repo/huge.md");

    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("clears no load indicator when a small-file read fails", async () => {
    mockReadTextFile.mockRejectedValueOnce(new Error("denied"));

    await openDroppedFileInNewTab(WINDOW, "/repo/fail.md");

    expect(useFileLoadStore.getState().active).toBe(false);
    expect(mockToastError).toHaveBeenCalledWith({
      key: "dialog:toast.failedToOpen",
      values: { filename: "fail.md" },
    });
  });

  it("uses the raw path for progress labels when a path has no file name", async () => {
    mockRouteOpenBySize.mockResolvedValue({
      proceed: true,
      forceSourceMode: false,
      sizeBytes: 400 * 1024,
    });

    await openDroppedFileInNewTab(WINDOW, "/");

    expect(useFileLoadStore.getState().filename).toBe("/");
  });
});
