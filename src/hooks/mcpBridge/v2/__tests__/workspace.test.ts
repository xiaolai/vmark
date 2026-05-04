// WI-1.4 — vmark.workspace lifecycle (new, save, save_as, close,
// switch_tab). open/focus_window are integration paths covered by
// the Tauri MCP smoke in WI-1.8.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import {
  handleWorkspaceNew,
  handleWorkspaceClose,
  handleWorkspaceSwitchTab,
  handleWorkspaceSave,
  handleWorkspaceSaveAs,
} from "../workspace";

vi.mock("../../utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

const writeMock = vi.fn<(path: string, content: string) => Promise<void>>(
  async () => undefined,
);
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: (path: string, content: string) => writeMock(path, content),
}));

import { respond } from "../../utils";

function resetStores() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
}

function lastRespond() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

function parseStructuredError(s: string | undefined) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

describe("vmark.workspace.new", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("creates an untitled tab and returns its tabId", async () => {
    await handleWorkspaceNew("req-1", {});
    const r = lastRespond();
    expect(r.success).toBe(true);
    const tabId = (r.data as { tabId: string }).tabId;
    expect(tabId).toBeTruthy();
    expect(useTabStore.getState().tabs.main[0].id).toBe(tabId);
  });
});

describe("vmark.workspace.close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("refuses to close a dirty tab without force", async () => {
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-d", filePath: null, title: "x", isPinned: false }],
      },
      activeTabId: { main: "t-d" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-d", "", null);
    useDocumentStore.getState().setContent("t-d", "dirty edits");

    await handleWorkspaceClose("req-1", { tabId: "t-d" });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ closed: false, reason: "DIRTY" });
    // Tab still present.
    expect(useTabStore.getState().tabs.main).toHaveLength(1);
  });

  it("closes a dirty tab when force is true", async () => {
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-d2", filePath: null, title: "x", isPinned: false }],
      },
      activeTabId: { main: "t-d2" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-d2", "", null);
    useDocumentStore.getState().setContent("t-d2", "dirty");

    await handleWorkspaceClose("req-2", { tabId: "t-d2", force: true });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ closed: true });
    expect(useTabStore.getState().tabs.main).toHaveLength(0);
  });

  it("rejects a missing tabId arg", async () => {
    await handleWorkspaceClose("req-3", {});
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_TAB",
    });
  });
});

describe("vmark.workspace.switch_tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("activates the target tab inside its window", async () => {
    useTabStore.setState({
      tabs: {
        main: [
          { id: "a", filePath: null, title: "A", isPinned: false },
          { id: "b", filePath: null, title: "B", isPinned: false },
        ],
      },
      activeTabId: { main: "a" },
      untitledCounter: 0,
      closedTabs: {},
    });
    await handleWorkspaceSwitchTab("req-1", { tabId: "b" });
    expect(useTabStore.getState().activeTabId.main).toBe("b");
    expect(lastRespond().success).toBe(true);
  });
});

describe("vmark.workspace.save / save_as", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("save writes the doc content to its existing filePath", async () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "t-s",
            filePath: "/tmp/notes.md",
            title: "notes",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "t-s" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-s", "hi", "/tmp/notes.md");
    useDocumentStore.getState().setContent("t-s", "updated");

    await handleWorkspaceSave("req-s", {});
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/tmp/notes.md", "updated");
    expect(useDocumentStore.getState().documents["t-s"].isDirty).toBe(false);
  });

  it("save returns INVALID_PATH on an untitled tab", async () => {
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-u", filePath: null, title: "u", isPinned: false }],
      },
      activeTabId: { main: "t-u" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-u", "x", null);
    await handleWorkspaceSave("req-bad", {});
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_PATH",
    });
  });

  it("save_as writes to the new path and updates filePath", async () => {
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-a", filePath: null, title: "u", isPinned: false }],
      },
      activeTabId: { main: "t-a" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-a", "hello", null);

    await handleWorkspaceSaveAs("req-a", {
      tabId: "t-a",
      filePath: "/tmp/new.md",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/tmp/new.md", "hello");
    expect(
      useDocumentStore.getState().documents["t-a"].filePath,
    ).toBe("/tmp/new.md");
  });
});
