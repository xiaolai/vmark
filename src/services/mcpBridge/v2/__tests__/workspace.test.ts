// WI-1.4 — vmark.workspace lifecycle (new, save, save_as, close,
// switch_tab). open/focus_window are integration paths covered by
// the Tauri MCP smoke in WI-1.8.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";

const setFocusMock = vi.fn(async () => {});
const getByLabelMock = vi.fn(async (label: string) => {
  if (label === "doc-1") return { setFocus: setFocusMock };
  return null;
});
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: (label: string) => getByLabelMock(label) },
}));

vi.mock("@/services/mcpBridge/utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

const writeMock = vi.fn<(path: string, content: string) => Promise<void>>(
  async () => undefined,
);
const readMock = vi.fn<(path: string) => Promise<string>>(async () => "");
// WI-5: save_as consults `exists` before overwriting. These suites cover the
// save-to-a-new-location paths, so the target is absent by default.
const existsMock = vi.fn<(path: string) => Promise<boolean>>(async () => false);
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (path: string) => readMock(path),
  writeTextFile: (path: string, content: string) => writeMock(path, content),
  exists: (path: string) => existsMock(path),
}));

const registerPendingSaveMock = vi.fn(() => 1);
const clearPendingSaveMock = vi.fn();
vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: (path: string, content: string) =>
    registerPendingSaveMock(path, content),
  clearPendingSave: (path: string, token?: number) =>
    clearPendingSaveMock(path, token),
}));

// The path guard itself is unit-tested in
// services/mcpBridge/bridgePathGuard.test.ts and
// utils/mcpBridgePathPolicy.test.ts. Here we mock it (default: allow) so the
// existing behavior tests stay green, and flip it to denied to assert that
// the handlers consult the guard and short-circuit before touching disk.
const checkBridgePathMock = vi.fn<
  (p: string) => Promise<{ allowed: boolean; reason?: string }>
>(async () => ({ allowed: true }));
vi.mock("@/services/mcpBridge/bridgePathGuard", () => ({
  checkBridgePath: (p: string) => checkBridgePathMock(p),
}));

const warningToastMock = vi.fn();
const infoToastMock = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    warning: (...a: unknown[]) => warningToastMock(...a),
    info: (...a: unknown[]) => infoToastMock(...a),
  },
}));

import { respond } from "@/services/mcpBridge/utils";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  handleWorkspaceNew,
  handleWorkspaceOpen,
  handleWorkspaceClose,
  handleWorkspaceSwitchTab,
  handleWorkspaceSave,
  handleWorkspaceSaveAs,
  handleWorkspaceFocusWindow,
} from "@/services/mcpBridge/v2/workspace";

/** Set the MCP auto-approve-edits toggle for the current test. */
function setAutoApproveEdits(value: boolean) {
  const s = useSettingsStore.getState();
  useSettingsStore.setState({
    advanced: {
      ...s.advanced,
      mcpServer: { ...s.advanced.mcpServer, autoApproveEdits: value },
    },
  });
}
function resetStores() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
  useRevisionStore.setState({ revisions: {} });
  existsMock.mockResolvedValue(false);
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

describe("vmark.workspace.open — YAML routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    readMock.mockResolvedValue("name: ci\non: push\njobs: {}\n");
  });

  it("opens .yml workflow files via the registry-driven YAML adapter", async () => {
    // WI-2.6: the YAML force-source bandaid was retired. .yml files now
    // dispatch to the YAML adapter (kind: split-pane) which never
    // mounts the WYSIWYG editor, so YAML indentation can't be corrupted
    // by a markdown round-trip.
    await handleWorkspaceOpen("req-yaml", {
      filePath: "/repo/.github/workflows/ci.yml",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    const tabId = (r.data as { tabId: string }).tabId;
    const doc = useDocumentStore.getState().documents[tabId];
    expect(doc).toBeDefined();
    expect(doc.filePath).toBe("/repo/.github/workflows/ci.yml");
  });

  it("opens markdown files normally (no force-source for non-YAML)", async () => {
    readMock.mockResolvedValue("# hi\n");
    await handleWorkspaceOpen("req-md", {
      filePath: "/repo/notes.md",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    const tabId = (r.data as { tabId: string }).tabId;
    expect(useDocumentStore.getState().documents[tabId]).toBeDefined();
  });
});

// WI-3 — `createTab` dedupes by normalized path, so opening a file that is
// already open returns the EXISTING tab id. The handler then re-initialised
// that tab unconditionally, replacing content/savedContent/isDirty and
// discarding unsaved user edits with no checkpoint and no revision bump.
describe("vmark.workspace.open — already-open tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    readMock.mockResolvedValue("# on disk\n");
  });

  it("does not discard unsaved edits when the file is already open and dirty", async () => {
    await handleWorkspaceOpen("req-first", { filePath: "/repo/notes.md" });
    const tabId = (lastRespond().data as { tabId: string }).tabId;

    // The user edits the open document without saving.
    useDocumentStore.getState().setEditorContent(tabId, "# my unsaved work");
    expect(useDocumentStore.getState().documents[tabId].isDirty).toBe(true);

    await handleWorkspaceOpen("req-second", { filePath: "/repo/notes.md" });

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ tabId, alreadyOpen: true, reloaded: false });
    // The buffer survived.
    const doc = useDocumentStore.getState().documents[tabId];
    expect(doc.content).toBe("# my unsaved work");
    expect(doc.isDirty).toBe(true);
  });

  it("explains why nothing was reloaded so the agent does not silently assume fresh content", async () => {
    await handleWorkspaceOpen("req-a", { filePath: "/repo/notes.md" });
    const tabId = (lastRespond().data as { tabId: string }).tabId;
    useDocumentStore.getState().setEditorContent(tabId, "dirty");

    await handleWorkspaceOpen("req-b", { filePath: "/repo/notes.md" });

    expect((lastRespond().data as { reason: string }).reason).toMatch(/unsaved/i);
  });

  it("still reloads a clean already-open tab and bumps the revision when disk content moved on", async () => {
    await handleWorkspaceOpen("req-c1", { filePath: "/repo/notes.md" });
    const tabId = (lastRespond().data as { tabId: string }).tabId;
    const before = useRevisionStore.getState().getRevision(tabId);

    readMock.mockResolvedValue("# changed on disk\n");
    await handleWorkspaceOpen("req-c2", { filePath: "/repo/notes.md" });

    const r = lastRespond();
    expect(r.data).toMatchObject({ tabId, alreadyOpen: true, reloaded: true });
    expect(useDocumentStore.getState().documents[tabId].content).toBe(
      "# changed on disk\n",
    );
    // A stale revision must not survive a content change.
    expect(useRevisionStore.getState().isCurrentRevision(tabId, before)).toBe(false);
  });

  // Round-1 audit finding (workspace.ts:119, High): only `isDirty` protected the
  // buffer. An `isDivergent` document is CLEAN but holds content the user
  // deliberately kept after answering "Keep my changes" to an external edit.
  it("does not discard content kept after an external modification (isDivergent, not dirty)", async () => {
    await handleWorkspaceOpen("req-div1", { filePath: "/repo/notes.md" });
    const tabId = (lastRespond().data as { tabId: string }).tabId;

    useDocumentStore.getState().markDivergent(tabId);
    const kept = useDocumentStore.getState().documents[tabId].content;
    expect(useDocumentStore.getState().documents[tabId].isDirty).toBe(false);

    readMock.mockResolvedValue("# whatever is on disk now\n");
    await handleWorkspaceOpen("req-div2", { filePath: "/repo/notes.md" });

    expect(lastRespond().data).toMatchObject({ reloaded: false });
    expect(useDocumentStore.getState().documents[tabId].content).toBe(kept);
  });

  // Round-1 audit finding (workspace.ts:138, High): reloading via initDocument
  // rebuilt the entry from scratch, silently clearing readOnly and leaving
  // documentId at 0 for a first-open doc so the editor might never remount.
  it("preserves read-only protection when reloading a clean already-open tab", async () => {
    await handleWorkspaceOpen("req-ro1", { filePath: "/repo/notes.md" });
    const tabId = (lastRespond().data as { tabId: string }).tabId;
    useDocumentStore.getState().setReadOnly(tabId, true);

    readMock.mockResolvedValue("# new disk content\n");
    await handleWorkspaceOpen("req-ro2", { filePath: "/repo/notes.md" });

    expect(useDocumentStore.getState().documents[tabId].readOnly).toBe(true);
  });

  it("increments documentId on reload so the editor remounts", async () => {
    await handleWorkspaceOpen("req-id1", { filePath: "/repo/notes.md" });
    const tabId = (lastRespond().data as { tabId: string }).tabId;
    const idBefore = useDocumentStore.getState().documents[tabId].documentId;

    readMock.mockResolvedValue("# new disk content\n");
    await handleWorkspaceOpen("req-id2", { filePath: "/repo/notes.md" });

    expect(useDocumentStore.getState().documents[tabId].documentId).toBe(idBefore + 1);
  });

  // Round-1 VERIFICATION finding (REGRESSED): switching the reload path to
  // `loadContent` dropped the `clearMissing` that every other disk-reload site
  // pairs with it (see services/persistence/reloadFromDisk.ts), so a file that
  // was deleted and then recreated stayed flagged as missing forever.
  it("clears the missing flag when a deleted file is reopened after being recreated", async () => {
    await handleWorkspaceOpen("req-miss1", { filePath: "/repo/notes.md" });
    const tabId = (lastRespond().data as { tabId: string }).tabId;

    // The file is deleted on disk; the watcher flags the tab.
    useDocumentStore.getState().markMissing(tabId);
    expect(useDocumentStore.getState().documents[tabId].isMissing).toBe(true);

    // The user recreates it and the agent reopens it — the read succeeds, so
    // the file demonstrably exists again.
    readMock.mockResolvedValue("# recreated\n");
    await handleWorkspaceOpen("req-miss2", { filePath: "/repo/notes.md" });

    const doc = useDocumentStore.getState().documents[tabId];
    expect(doc.isMissing).toBe(false);
    expect(doc.content).toBe("# recreated\n");
  });

  it("reports a first-time open as not already-open", async () => {
    await handleWorkspaceOpen("req-fresh", { filePath: "/repo/fresh.md" });
    expect(lastRespond().data).toMatchObject({ alreadyOpen: false, reloaded: true });
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
    useDocumentStore.getState().setEditorContent("t-d", "dirty edits");

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
    useDocumentStore.getState().setEditorContent("t-d2", "dirty");

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

  it("activates any enumerated browser webpage by its stable tab id", async () => {
    const first = useTabStore.getState().createBrowserTab("main", "https://one.example");
    const second = useTabStore.getState().createBrowserPage("main", "https://two.example");

    await handleWorkspaceSwitchTab("req-browser", { tabId: first });
    expect(useTabStore.getState().activeTabId.main).toBe(first);

    await handleWorkspaceSwitchTab("req-browser-2", { tabId: second });
    expect(useTabStore.getState().activeTabId.main).toBe(second);
    expect(lastRespond().success).toBe(true);
  });
});

describe("vmark.workspace.save / save_as", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    writeMock.mockReset().mockResolvedValue(undefined);
    registerPendingSaveMock.mockReset().mockReturnValue(1);
    clearPendingSaveMock.mockReset();
    // These tests assert write mechanics on (often new) paths; treat the user
    // as having granted approval. The auto-approve gate itself is covered in
    // its own describe block below.
    setAutoApproveEdits(true);
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
    useDocumentStore.getState().setEditorContent("t-s", "updated");

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

  it("save registers and clears pending save around writeTextFile to suppress the external-change dialog", async () => {
    vi.useFakeTimers();
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "t-ps",
            filePath: "/tmp/notes.md",
            title: "notes",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "t-ps" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-ps", "hi", "/tmp/notes.md");
    useDocumentStore.getState().setEditorContent("t-ps", "updated");

    await handleWorkspaceSave("req-ps", {});

    expect(registerPendingSaveMock).toHaveBeenCalledWith("/tmp/notes.md", "updated");
    // Audit T9: delayed clear — the same 1000ms window as saveToPath.
    expect(clearPendingSaveMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    expect(clearPendingSaveMock).toHaveBeenCalledWith("/tmp/notes.md", 1);
    const registerOrder = registerPendingSaveMock.mock.invocationCallOrder[0];
    const writeOrder = writeMock.mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(writeOrder);
  });

  it("save clears pending save even when writeTextFile rejects", async () => {
    vi.useFakeTimers();
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "t-ps-fail",
            filePath: "/readonly/notes.md",
            title: "notes",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "t-ps-fail" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-ps-fail", "x", "/readonly/notes.md");
    writeMock.mockRejectedValueOnce(new Error("EACCES"));

    await handleWorkspaceSave("req-ps-fail", {});

    expect(registerPendingSaveMock).toHaveBeenCalledWith("/readonly/notes.md", "x");
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    expect(clearPendingSaveMock).toHaveBeenCalledWith("/readonly/notes.md", 1);
  });

  it("save_as registers and clears pending save around writeTextFile to suppress the external-change dialog", async () => {
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-as", filePath: null, title: "u", isPinned: false }],
      },
      activeTabId: { main: "t-as" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-as", "hello", null);

    await handleWorkspaceSaveAs("req-as", {
      tabId: "t-as",
      filePath: "/tmp/new.md",
    });

    expect(registerPendingSaveMock).toHaveBeenCalledWith("/tmp/new.md", "hello");
    expect(clearPendingSaveMock).toHaveBeenCalledWith("/tmp/new.md", 1);
    const registerOrder = registerPendingSaveMock.mock.invocationCallOrder[0];
    const writeOrder = writeMock.mock.invocationCallOrder[0];
    const clearOrder = clearPendingSaveMock.mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(writeOrder);
    expect(writeOrder).toBeLessThan(clearOrder);
  });

  it("save_as clears pending save even when writeTextFile rejects", async () => {
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-as-fail", filePath: null, title: "u", isPinned: false }],
      },
      activeTabId: { main: "t-as-fail" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-as-fail", "hello", null);
    writeMock.mockRejectedValueOnce(new Error("EACCES"));

    await expect(
      handleWorkspaceSaveAs("req-as-fail", {
        tabId: "t-as-fail",
        filePath: "/readonly/new.md",
      }),
    ).resolves.toBeUndefined();

    expect(registerPendingSaveMock).toHaveBeenCalledWith("/readonly/new.md", "hello");
    expect(clearPendingSaveMock).toHaveBeenCalledWith("/readonly/new.md", 1);
  });
});

describe("vmark.workspace.focus_window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("rejects non-string windowLabel as a structured INTERNAL error", async () => {
    await handleWorkspaceFocusWindow("req-fw-1", {});
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({ error: "INTERNAL" });
    expect(setFocusMock).not.toHaveBeenCalled();
  });

  it("focuses the window identified by the label", async () => {
    await handleWorkspaceFocusWindow("req-fw-2", { windowLabel: "doc-1" });
    expect(getByLabelMock).toHaveBeenCalledWith("doc-1");
    expect(setFocusMock).toHaveBeenCalledTimes(1);
    const r = lastRespond();
    expect(r.success).toBe(true);
  });

  it("returns a structured INTERNAL error when the label does not resolve to a window", async () => {
    await handleWorkspaceFocusWindow("req-fw-3", { windowLabel: "ghost" });
    expect(setFocusMock).not.toHaveBeenCalled();
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INTERNAL",
      message: expect.stringMatching(/ghost/),
    });
  });

  it("treats a setFocus rejection as success (best-effort focus per the existing contract)", async () => {
    setFocusMock.mockRejectedValueOnce(new Error("denied"));
    await handleWorkspaceFocusWindow("req-fw-4", { windowLabel: "doc-1" });
    const r = lastRespond();
    expect(r.success).toBe(true);
  });
});

describe("vmark.workspace — path scope guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    readMock.mockReset().mockResolvedValue("secret");
    writeMock.mockReset().mockResolvedValue(undefined);
    // Isolate the path-scope guard from the auto-approve gate.
    setAutoApproveEdits(true);
  });

  it("open rejects an out-of-scope path and never reads from disk", async () => {
    checkBridgePathMock.mockResolvedValueOnce({
      allowed: false,
      reason: "Path is outside the workspace and open documents",
    });
    await handleWorkspaceOpen("req-open-evil", {
      filePath: "/Users/me/.ssh/id_rsa",
    });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_PATH",
    });
    expect(readMock).not.toHaveBeenCalled();
  });

  it("save_as rejects an out-of-scope path and never writes to disk", async () => {
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-evil", filePath: null, title: "u", isPinned: false }],
      },
      activeTabId: { main: "t-evil" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-evil", "payload", null);
    checkBridgePathMock.mockResolvedValueOnce({
      allowed: false,
      reason: "Path is outside the workspace and open documents",
    });

    await handleWorkspaceSaveAs("req-saveas-evil", {
      tabId: "t-evil",
      filePath: "/Users/me/.zshenv",
    });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_PATH",
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("save rejects when the guard denies the tab's own path (defense in depth)", async () => {
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "t-own",
            filePath: "/outside/notes.md",
            title: "notes",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "t-own" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-own", "x", "/outside/notes.md");
    checkBridgePathMock.mockResolvedValueOnce({
      allowed: false,
      reason: "Path is outside the workspace and open documents",
    });

    await handleWorkspaceSave("req-save-evil", {});
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_PATH",
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("save_as proceeds when the guard allows the path (no regression)", async () => {
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-ok", filePath: null, title: "u", isPinned: false }],
      },
      activeTabId: { main: "t-ok" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-ok", "hello", null);
    // default mock → allowed

    await handleWorkspaceSaveAs("req-saveas-ok", {
      tabId: "t-ok",
      filePath: "/tmp/in-scope.md",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/tmp/in-scope.md", "hello");
  });
});

describe("vmark.workspace.save_as — auto-approve gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    writeMock.mockReset().mockResolvedValue(undefined);
    registerPendingSaveMock.mockReset().mockReturnValue(1);
    clearPendingSaveMock.mockReset();
    // checkBridgePath default → allowed; the gate is the subject here.
  });

  it("blocks save_as to a NEW location with APPROVAL_REQUIRED + toast when auto-approve is off", async () => {
    setAutoApproveEdits(false);
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "t-g",
            filePath: "/ws/orig.md",
            title: "orig",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "t-g" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-g", "hi", "/ws/orig.md");

    await handleWorkspaceSaveAs("req-gate", {
      tabId: "t-g",
      filePath: "/ws/elsewhere.md",
    });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "APPROVAL_REQUIRED",
    });
    expect(writeMock).not.toHaveBeenCalled();
    expect(warningToastMock).toHaveBeenCalledTimes(1);
  });

  it("allows save_as to the tab's OWN current path even when auto-approve is off (normal round-trip)", async () => {
    setAutoApproveEdits(false);
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "t-own2",
            filePath: "/ws/orig.md",
            title: "orig",
            isPinned: false,
          },
        ],
      },
      activeTabId: { main: "t-own2" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-own2", "hi", "/ws/orig.md");

    await handleWorkspaceSaveAs("req-own", {
      tabId: "t-own2",
      filePath: "/ws/orig.md",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/ws/orig.md", "hi");
    expect(warningToastMock).not.toHaveBeenCalled();
  });

  it("allows save_as to a new location when auto-approve is on", async () => {
    setAutoApproveEdits(true);
    useTabStore.setState({
      tabs: {
        main: [{ id: "t-on", filePath: null, title: "u", isPinned: false }],
      },
      activeTabId: { main: "t-on" },
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.getState().initDocument("t-on", "hello", null);

    await handleWorkspaceSaveAs("req-on", {
      tabId: "t-on",
      filePath: "/ws/new.md",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/ws/new.md", "hello");
  });
});

// `getWindowLabel` prefers an explicit `windowLabel` arg over the current
// window. Every existing test omits it, so the explicit branch was never taken.
describe("vmark.workspace — explicit windowLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("creates the tab in the window the caller names, not the current one", async () => {
    await handleWorkspaceNew("req-wl", { windowLabel: "doc-2" });

    const r = lastRespond();
    expect(r.success).toBe(true);
    const tabId = (r.data as { tabId: string }).tabId;
    expect(useTabStore.getState().tabs["doc-2"]?.[0]?.id).toBe(tabId);
    expect(useTabStore.getState().tabs.main).toBeUndefined();
  });

  it("ignores an empty windowLabel and falls back to the current window", async () => {
    await handleWorkspaceNew("req-wl-empty", { windowLabel: "" });

    const tabId = (lastRespond().data as { tabId: string }).tabId;
    expect(useTabStore.getState().tabs.main?.[0]?.id).toBe(tabId);
  });
});
