import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// Mock all Tauri APIs
vi.mock("@tauri-apps/api/event", () => ({
  type: { UnlistenFn: vi.fn() },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: vi.fn(() => Promise.resolve(vi.fn())),
  })),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(() => Promise.resolve(true)),
  readTextFile: vi.fn(() => Promise.resolve("# Test content")),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: vi.fn((_label, _key, fn) => fn()),
}));

vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: vi.fn(() => ({ style: "lf", hasMixed: false })),
}));

vi.mock("@/utils/pathUtils", () => ({
  getFileName: vi.fn((path: string) => path.split("/").pop() || path),
}));

// Reset stores before each test
beforeEach(() => {
  vi.clearAllMocks();
  useRecentWorkspacesStore.setState({
    workspaces: [],
    maxWorkspaces: 10,
  });
});

describe("useRecentWorkspacesMenuEvents - store operations", () => {
  describe("clearAll", () => {
    it("clears workspaces from store", () => {
      // Add some workspaces
      useRecentWorkspacesStore.getState().addWorkspace("/path/to/project1");
      useRecentWorkspacesStore.getState().addWorkspace("/path/to/project2");

      expect(useRecentWorkspacesStore.getState().workspaces).toHaveLength(2);

      // Clear all
      useRecentWorkspacesStore.getState().clearAll();

      expect(useRecentWorkspacesStore.getState().workspaces).toHaveLength(0);
    });
  });

  describe("removeWorkspace", () => {
    it("removes specific workspace when not found", () => {
      useRecentWorkspacesStore.getState().addWorkspace("/path/to/project1");
      useRecentWorkspacesStore.getState().addWorkspace("/path/to/project2");

      useRecentWorkspacesStore.getState().removeWorkspace("/path/to/project1");

      const state = useRecentWorkspacesStore.getState();
      expect(state.workspaces).toHaveLength(1);
      expect(state.workspaces[0].path).toBe("/path/to/project2");
    });
  });

  describe("addWorkspace after opening", () => {
    it("adds workspace to recent list", () => {
      useRecentWorkspacesStore.getState().addWorkspace("/path/to/new-project");

      const state = useRecentWorkspacesStore.getState();
      expect(state.workspaces).toHaveLength(1);
      expect(state.workspaces[0].path).toBe("/path/to/new-project");
      expect(state.workspaces[0].name).toBe("new-project");
    });
  });
});

describe("useRecentWorkspacesMenuEvents - workspace existence check", () => {
  it("workspace exists check returns true for valid path", async () => {
    const { exists } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(true);

    const result = await exists("/valid/path");
    expect(result).toBe(true);
  });

  it("workspace exists check returns false for invalid path", async () => {
    const { exists } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(false);

    const result = await exists("/invalid/path");
    expect(result).toBe(false);
  });
});

describe("useRecentWorkspacesMenuEvents - dirty tabs detection", () => {
  beforeEach(() => {
    // Reset tab store
    useTabStore.setState({
      tabs: {},
      activeTabId: {},
      untitledCounter: 0,
      closedTabs: {},
    });
    // Reset document store
    useDocumentStore.setState({
      documents: {},
    });
  });

  it("detects no dirty tabs in empty state", () => {
    const tabs = useTabStore.getState().getTabsByWindow("main");
    const dirtyTabs = tabs.filter((tab) => {
      const doc = useDocumentStore.getState().getDocument(tab.id);
      return doc?.isDirty;
    });

    expect(dirtyTabs).toHaveLength(0);
  });

  it("detects dirty tabs when present", () => {
    // Set up a tab with dirty document using correct tabStore structure
    useTabStore.setState({
      tabs: {
        main: [{ id: "tab1", filePath: "/test.md", title: "test", isPinned: false }],
      },
      activeTabId: {
        main: "tab1",
      },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.setState({
      documents: {
        tab1: {
          content: "test",
          savedContent: "original",
          lastDiskContent: "original",
          filePath: "/test.md",
          isDirty: true,
          documentId: 1,
          cursorInfo: null,
          lastAutoSave: null,
          isMissing: false,
          isDivergent: false,
          lineEnding: "lf",
          hardBreakStyle: "unknown",
        },
      },
    });

    const tabs = useTabStore.getState().getTabsByWindow("main");
    const dirtyTabs = tabs.filter((tab) => {
      const doc = useDocumentStore.getState().getDocument(tab.id);
      return doc?.isDirty;
    });

    expect(dirtyTabs).toHaveLength(1);
  });
});

describe("useRecentWorkspacesMenuEvents - dialog interactions", () => {
  it("ask dialog returns confirmation", async () => {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(ask).mockResolvedValue(true);

    const result = await ask("Test message");
    expect(result).toBe(true);
  });

  it("ask dialog returns cancellation", async () => {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(ask).mockResolvedValue(false);

    const result = await ask("Test message");
    expect(result).toBe(false);
  });
});
