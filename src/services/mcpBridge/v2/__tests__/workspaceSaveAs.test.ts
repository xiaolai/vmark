// vmark.workspace.save_as — edge-case coverage for the dedicated
// handler module. The happy path, path-scope guard, auto-approve gate,
// and pending-save ordering are covered in workspace.test.ts; this file
// pins the argument-validation and tab-resolution branches plus the
// wrapHandler error contract on write failure.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";

vi.mock("@/services/mcpBridge/utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

const writeMock = vi.fn<(path: string, content: string) => Promise<void>>(
  async () => undefined,
);
const existsMock = vi.fn<(path: string) => Promise<boolean>>(async () => false);
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (path: string, content: string) => writeMock(path, content),
  exists: (path: string) => existsMock(path),
}));

const registerPendingSaveMock = vi.fn(() => 7);
const clearPendingSaveMock = vi.fn();
vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: (path: string, content: string) =>
    registerPendingSaveMock(path, content),
  clearPendingSave: (path: string, token?: number) =>
    clearPendingSaveMock(path, token),
}));

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
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";

function lastRespond() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

function structuredError() {
  const r = lastRespond();
  return r.error ? JSON.parse(r.error) : null;
}

function seedTab(id: string, filePath: string | null, active = true) {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id, filePath, title: "t", isPinned: false }] },
    activeTabId: active ? { main: id } : {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
  checkBridgePathMock.mockResolvedValue({ allowed: true });
  existsMock.mockResolvedValue(false);
  const s = useSettingsStore.getState();
  useSettingsStore.setState({
    advanced: {
      ...s.advanced,
      mcpServer: { ...s.advanced.mcpServer, autoApproveEdits: true },
    },
  });
});

describe("save_as argument validation", () => {
  it.each([
    { label: "missing", args: {} },
    { label: "empty string", args: { filePath: "" } },
    { label: "non-string", args: { filePath: 42 } },
  ])("rejects a $label filePath before consulting the guard or disk", async ({ args }) => {
    await handleWorkspaceSaveAs("req-v", args as Record<string, unknown>);
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(structuredError()).toMatchObject({
      error: "INVALID_PATH",
      message: "filePath must be a non-empty string",
    });
    expect(checkBridgePathMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });
});

describe("save_as tab resolution", () => {
  it("rejects an explicit tabId that matches no open tab", async () => {
    seedTab("real-tab", null);
    useDocumentStore.getState().initDocument("real-tab", "x", null);

    await handleWorkspaceSaveAs("req-t1", {
      tabId: "ghost-tab",
      filePath: "/tmp/out.md",
    });
    expect(lastRespond().success).toBe(false);
    expect(structuredError()).toMatchObject({
      error: "INVALID_TAB",
      message: "Unknown tabId",
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("rejects when no tabId is given and no tab is focused", async () => {
    await handleWorkspaceSaveAs("req-t2", { filePath: "/tmp/out.md" });
    expect(lastRespond().success).toBe(false);
    expect(structuredError()).toMatchObject({
      error: "INVALID_TAB",
      message: "No focused tab",
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("rejects a tab that has no backing document", async () => {
    seedTab("orphan", null);
    // No initDocument — the tab exists but the document store has no entry.
    await handleWorkspaceSaveAs("req-t3", {
      tabId: "orphan",
      filePath: "/tmp/out.md",
    });
    expect(lastRespond().success).toBe(false);
    expect(structuredError()).toMatchObject({
      error: "INVALID_TAB",
      message: "No document for tab",
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("falls back to the focused tab when no tabId is supplied", async () => {
    seedTab("focused", null);
    useDocumentStore.getState().initDocument("focused", "body", null);

    await handleWorkspaceSaveAs("req-t4", { filePath: "/tmp/focused.md" });
    expect(lastRespond().success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/tmp/focused.md", "body");
  });
});

describe("save_as write failure and success contract", () => {
  it("responds with the wrapHandler error contract when the write rejects, keeping the tab path unchanged", async () => {
    seedTab("t-fail", null);
    useDocumentStore.getState().initDocument("t-fail", "content", null);
    writeMock.mockRejectedValueOnce(new Error("disk full"));

    await handleWorkspaceSaveAs("req-f", {
      tabId: "t-fail",
      filePath: "/tmp/full.md",
    });
    const r = lastRespond();
    expect(r).toMatchObject({ id: "req-f", success: false });
    expect(r.error).toContain("disk full");
    // The failed save must not rebind the document to the new path.
    expect(useDocumentStore.getState().documents["t-fail"].filePath).toBeNull();
    expect(useTabStore.getState().tabs.main[0].filePath).toBeNull();
    // Pending-save registration is still cleaned up (token round-trip).
    expect(clearPendingSaveMock).toHaveBeenCalledWith("/tmp/full.md", 7);
  });

  it("on success updates tab path/title, marks the doc saved, and returns the revision", async () => {
    seedTab("t-ok", null);
    useDocumentStore.getState().initDocument("t-ok", "hello", null);
    useDocumentStore.getState().setContent("t-ok", "edited");

    await handleWorkspaceSaveAs("req-ok", {
      tabId: "t-ok",
      filePath: "/tmp/renamed.md",
    });

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      revision: useRevisionStore.getState().getRevision("t-ok"),
    });
    const tab = useTabStore.getState().tabs.main[0];
    expect(tab.filePath).toBe("/tmp/renamed.md");
    expect(tab.title).toBe("renamed.md");
    const doc = useDocumentStore.getState().documents["t-ok"];
    expect(doc.filePath).toBe("/tmp/renamed.md");
    expect(doc.isDirty).toBe(false);
    expect(writeMock).toHaveBeenCalledWith("/tmp/renamed.md", "edited");
  });
});

// WI-5 — `autoApproveEdits` authorises saving to a NEW location. It must not
// authorise destroying an EXISTING distinct file: the bridge's allowed roots
// include the parent directory of every open document, so an auto-approved
// save_as could silently overwrite any sibling of any open file.
describe("save_as overwrite protection", () => {
  it("refuses to clobber an existing distinct file even when autoApproveEdits is on", async () => {
    seedTab("tab-1", "/ws/original.md");
    useDocumentStore.getState().initDocument("tab-1", "body", "/ws/original.md");
    existsMock.mockResolvedValue(true);

    await handleWorkspaceSaveAs("req-clobber", { filePath: "/ws/victim.md" });

    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(structuredError()).toMatchObject({ error: "APPROVAL_REQUIRED" });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("names the file that would be destroyed so the agent can report it", async () => {
    seedTab("tab-1", "/ws/original.md");
    useDocumentStore.getState().initDocument("tab-1", "body", "/ws/original.md");
    existsMock.mockResolvedValue(true);

    await handleWorkspaceSaveAs("req-msg", { filePath: "/ws/victim.md" });

    expect(structuredError().message).toContain("victim.md");
  });

  it("still allows save_as to the tab's own path when the file exists", async () => {
    // Saving over yourself is a save, not a clobber.
    seedTab("tab-1", "/ws/original.md");
    useDocumentStore.getState().initDocument("tab-1", "body", "/ws/original.md");
    existsMock.mockResolvedValue(true);

    await handleWorkspaceSaveAs("req-self", { filePath: "/ws/original.md" });

    expect(lastRespond().success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/ws/original.md", "body");
  });

  it("allows save_as to a genuinely new path", async () => {
    seedTab("tab-1", "/ws/original.md");
    useDocumentStore.getState().initDocument("tab-1", "body", "/ws/original.md");
    existsMock.mockResolvedValue(false);

    await handleWorkspaceSaveAs("req-new", { filePath: "/ws/fresh.md" });

    expect(lastRespond().success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/ws/fresh.md", "body");
  });

  it("checks existence only after the path guard admits the target", async () => {
    seedTab("tab-1", "/ws/original.md");
    useDocumentStore.getState().initDocument("tab-1", "body", "/ws/original.md");
    checkBridgePathMock.mockResolvedValue({ allowed: false, reason: "outside roots" });

    await handleWorkspaceSaveAs("req-order", { filePath: "/etc/passwd" });

    expect(existsMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });
});

// `getFileName(path) || fallback` appears three times — in the approval toast,
// in the overwrite refusal, and in the tab title. A path with no basename is
// the only input that exercises the right-hand side, and it must not produce
// an empty toast or a blank tab.
describe("save_as with a path that has no filename component", () => {
  it("names the whole path in the overwrite refusal", async () => {
    seedTab("tab-1", "/ws/original.md");
    useDocumentStore.getState().initDocument("tab-1", "body", "/ws/original.md");
    existsMock.mockResolvedValue(true);

    await handleWorkspaceSaveAs("req-noname", { filePath: "/" });

    expect(lastRespond().success).toBe(false);
    expect(structuredError().message).toContain("/");
  });

  it("falls back to Untitled for the tab title", async () => {
    seedTab("tab-1", null);
    useDocumentStore.getState().initDocument("tab-1", "body", null);
    existsMock.mockResolvedValue(false);

    await handleWorkspaceSaveAs("req-title", { filePath: "/" });

    expect(lastRespond().success).toBe(true);
    expect(useTabStore.getState().tabs.main[0].title).toBe("Untitled");
  });

  it("names the whole path in the approval toast when auto-approve is off", async () => {
    const s = useSettingsStore.getState();
    useSettingsStore.setState({
      advanced: { ...s.advanced, mcpServer: { ...s.advanced.mcpServer, autoApproveEdits: false } },
    });
    seedTab("tab-1", "/ws/original.md");
    useDocumentStore.getState().initDocument("tab-1", "body", "/ws/original.md");

    await handleWorkspaceSaveAs("req-toast", { filePath: "/" });

    expect(structuredError()).toMatchObject({ error: "APPROVAL_REQUIRED" });
    expect(warningToastMock).toHaveBeenCalled();
  });
});
