import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
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

describe("getDefaultSaveFolderWithFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
