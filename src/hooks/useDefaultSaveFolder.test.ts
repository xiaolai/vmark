import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { getDefaultSaveFolderWithFallback } from "./useDefaultSaveFolder";

// Mock documentDir and homeDir specifically for this test
const mockDocumentDir = vi.fn();
const mockHomeDir = vi.fn();
vi.mock("@tauri-apps/api/path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/path")>();
  return {
    ...actual,
    documentDir: (...args: unknown[]) => mockDocumentDir(...args),
    homeDir: (...args: unknown[]) => mockHomeDir(...args),
  };
});

const WINDOW_LABEL = "main";
const storage = new Map<string, string>();

function installLocalStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
}

function addInstance(workspaceInstanceId: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId,
      root: root.root,
      ownerWindowLabel: WINDOW_LABEL,
      createdFrom: "open",
    }),
  );
}

describe("getDefaultSaveFolderWithFallback", () => {
  beforeEach(() => {
    installLocalStorage();
    storage.clear();
    vi.clearAllMocks();
    useSettingsStore.setState({
      general: {
        ...useSettingsStore.getState().general,
        workspaceRailMode: false,
      },
    });
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    useWorkspaceStore.setState({
      rootPath: null,
      config: null,
      isWorkspaceMode: false,
    });
    useTabStore.getState().removeWindow(WINDOW_LABEL);
    useDocumentStore.setState({ documents: {} });

    mockDocumentDir.mockResolvedValue("/Users/test/Documents");
    mockHomeDir.mockResolvedValue("/Users/test");
  });

  it("returns workspace root when in workspace mode", async () => {
    useWorkspaceStore.setState({
      rootPath: "/workspace/project",
      isWorkspaceMode: true,
    });

    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    expect(result).toBe("/workspace/project");
  });

  it("returns the active instance root when rail mode is enabled", async () => {
    useSettingsStore.setState({
      general: {
        ...useSettingsStore.getState().general,
        workspaceRailMode: true,
      },
    });
    useWorkspaceStore.setState({
      rootPath: "/workspace/legacy",
      isWorkspaceMode: true,
    });
    addInstance("wsi-active", "/workspace/active");

    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    expect(result).toBe("/workspace/active");
  });

  it("returns Documents directory when not in workspace mode and no saved tabs", async () => {
    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    expect(result).toBe("/Users/test/Documents");
  });

  it("returns saved tab folder when not in workspace mode with saved tabs", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/projects/notes/file.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/projects/notes/file.md", "content");

    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    expect(result).toBe("/projects/notes");
  });

  it("falls back to home directory when documentDir throws", async () => {
    mockDocumentDir.mockRejectedValue(new Error("not available"));

    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    expect(result).toBe("/Users/test");
  });

  it("resolves to an empty last-resort folder when both documentDir and homeDir reject", async () => {
    mockDocumentDir.mockRejectedValue(new Error("no documents dir"));
    mockHomeDir.mockRejectedValue(new Error("no home dir"));

    // Must resolve (not reject) so the Save As flow can still open a dialog at
    // the OS default location rather than throwing an unhandled rejection.
    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    expect(result).toBe("");
  });

  it("still prefers a sibling tab folder when both path APIs reject", async () => {
    mockDocumentDir.mockRejectedValue(new Error("no documents dir"));
    mockHomeDir.mockRejectedValue(new Error("no home dir"));

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/projects/notes/file.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/projects/notes/file.md", "content");

    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    expect(result).toBe("/projects/notes");
  });

  it("gathers saved file paths from tabs", async () => {
    useWorkspaceStore.setState({
      rootPath: null,
      isWorkspaceMode: true,
    });

    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, "/projects/docs/file.md");
    useDocumentStore.getState().initDocument(tabId, "content", "/projects/docs/file.md", "content");

    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    // In workspace mode with no root but saved file paths, should return the file's directory
    expect(result).toBe("/projects/docs");
  });

  it("handles window with no tabs", async () => {
    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    expect(result).toBe("/Users/test/Documents");
  });

  it("skips tabs without file paths in document store", async () => {
    useWorkspaceStore.setState({
      rootPath: null,
      isWorkspaceMode: true,
    });

    // Create tab with no filePath
    const tabId = useTabStore.getState().createTab(WINDOW_LABEL, null);
    useDocumentStore.getState().initDocument(tabId, "content", null, "content");

    const result = await getDefaultSaveFolderWithFallback(WINDOW_LABEL);
    // Falls through to fallback directory
    expect(result).toBe("/Users/test/Documents");
  });
});
