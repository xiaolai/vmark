// @vitest-environment node
// WI-FL5.8 — moveTabToNewWindow: the #1081 detach flow (ledger F7,
// tab-context-menu). The tab leaves this window only AFTER Rust has built the
// new one; a failed window creation leaves the tab exactly where it was; the
// toast's Undo hands the transfer back through the caller's restore.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { TabTransferPayload } from "@/types/tabTransfer";
import { moveTabToNewWindow } from "./moveTabToNewWindow";

const bridge = vi.hoisted(() => ({ label: "main" }));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: bridge.label }),
}));

// sonner is the external boundary; the IME-safe wrapper runs real.
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const mockInvoke = vi.mocked(invoke);
const mockToast = vi.mocked(toast);

type UndoToastOptions = { action: { label: string; onClick: () => void } };

function openTab(windowLabel: string, filePath: string, content = "hello") {
  const id = useTabStore.getState().createTab(windowLabel, filePath);
  useDocumentStore.getState().initDocument(id, content, filePath);
  return id;
}

function args(windowLabel: string, tabId: string, overrides: Partial<Parameters<typeof moveTabToNewWindow>[0]> = {}) {
  const tab = useTabStore.getState().findTabById(tabId);
  if (!tab) throw new Error(`tab ${tabId} not open`);
  return {
    tab,
    doc: useDocumentStore.getState().getDocument(tabId),
    filePath: tab.kind === "document" ? tab.filePath : null,
    tabs: useTabStore.getState().getTabsByWindow(windowLabel),
    windowLabel,
    workspaceRoot: "/ws",
    restoreTransferredTab: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const tabIds = (windowLabel: string) => useTabStore.getState().getTabsByWindow(windowLabel).map((t) => t.id);
const detachCalls = () => mockInvoke.mock.calls.filter((c) => c[0] === "detach_tab_to_new_window");
const closeCalls = () => mockInvoke.mock.calls.filter((c) => c[0] === "close_window");

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockReset().mockResolvedValue(undefined);
  bridge.label = "main";
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

describe("moveTabToNewWindow — guards", () => {
  it("refuses a tab that has no document — nothing to transfer", async () => {
    openTab("main", "/ws/other.md");
    const id = openTab("main", "/ws/a.md");

    await moveTabToNewWindow(args("main", id, { doc: undefined }));

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(tabIds("main")).toContain(id);
  });

  it("refuses to move the main window's last tab", async () => {
    const id = openTab("main", "/ws/a.md");

    await moveTabToNewWindow(args("main", id));

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(tabIds("main")).toEqual([id]);
  });

  it("a secondary window MAY move its last tab — the main-window rule does not apply", async () => {
    bridge.label = "doc-2";
    const id = openTab("doc-2", "/ws/a.md");
    mockInvoke.mockResolvedValueOnce("doc-3");

    await moveTabToNewWindow(args("doc-2", id));

    expect(detachCalls()).toHaveLength(1);
    expect(tabIds("doc-2")).toEqual([]);
  });
});

describe("moveTabToNewWindow — the transfer", () => {
  it("hands Rust the full payload, then removes the tab and its per-tab state from this window", async () => {
    openTab("main", "/ws/other.md");
    const id = openTab("main", "/ws/a.md", "hello\nworld");
    mockInvoke.mockResolvedValueOnce("doc-2");

    await moveTabToNewWindow(args("main", id));

    const payload = detachCalls()[0]?.[1] as { data: TabTransferPayload };
    expect(payload.data).toEqual(
      expect.objectContaining({
        tabId: id,
        title: "a.md",
        filePath: "/ws/a.md",
        workspaceRoot: "/ws",
        content: "hello\nworld",
        savedContent: "hello\nworld",
        isDirty: false,
      }),
    );
    expect(tabIds("main")).not.toContain(id);
    expect(useDocumentStore.getState().getDocument(id)).toBeUndefined();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("carries the file's line convention when the buffer knows it, and a null workspace when there is none", async () => {
    openTab("main", "/ws/other.md");
    const id = openTab("main", "/ws/crlf.md", "one\r\ntwo");
    // What the disk-open path records once it has read the file's bytes.
    useDocumentStore.getState().setLineMetadata(id, { lineEnding: "crlf" });
    mockInvoke.mockResolvedValueOnce("doc-2");

    await moveTabToNewWindow(args("main", id, { workspaceRoot: undefined }));

    const payload = (detachCalls()[0]?.[1] as { data: TabTransferPayload }).data;
    expect(payload.workspaceRoot).toBeNull();
    expect(payload.content).toBe("one\ntwo"); // canonical text on the wire…
    expect(payload.lineEnding).toBe("crlf"); // …with the convention carried beside it
  });

  it("omits a convention the buffer does not know, rather than asserting 'unknown' on the wire", async () => {
    openTab("main", "/ws/other.md");
    const id = openTab("main", "/ws/fresh.md", "one\ntwo");
    mockInvoke.mockResolvedValueOnce("doc-2");

    await moveTabToNewWindow(args("main", id));

    const payload = (detachCalls()[0]?.[1] as { data: TabTransferPayload }).data;
    expect("lineEnding" in payload).toBe(false);
    expect("hasBom" in payload).toBe(false);
  });

  it("offers Undo, which hands the transfer back to the caller's restore with source, destination and payload", async () => {
    openTab("main", "/ws/other.md");
    const id = openTab("main", "/ws/a.md");
    mockInvoke.mockResolvedValueOnce("doc-2");
    const restoreTransferredTab = vi.fn(() => Promise.resolve());

    await moveTabToNewWindow(args("main", id, { restoreTransferredTab }));

    expect(mockToast.message).toHaveBeenCalledTimes(1);
    const [message, options] = mockToast.message.mock.calls[0] as unknown as [string, UndoToastOptions];
    expect(message).toContain("a.md");
    options.action.onClick();
    expect(restoreTransferredTab).toHaveBeenCalledWith(
      "main",
      "doc-2",
      expect.objectContaining({ tabId: id, filePath: "/ws/a.md" }),
    );
  });

  it("a failed Undo is reported with a toast instead of an unhandled rejection", async () => {
    openTab("main", "/ws/other.md");
    const id = openTab("main", "/ws/a.md");
    mockInvoke.mockResolvedValueOnce("doc-2");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const restoreTransferredTab = vi.fn(() => Promise.reject(new Error("destination refused")));

    await moveTabToNewWindow(args("main", id, { restoreTransferredTab }));
    const [, options] = mockToast.message.mock.calls[0] as unknown as [string, UndoToastOptions];
    options.action.onClick();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("closes a secondary window once its last tab has left; the main window never closes", async () => {
    bridge.label = "doc-2";
    const id = openTab("doc-2", "/ws/a.md");
    mockInvoke.mockResolvedValueOnce("doc-3");

    await moveTabToNewWindow(args("doc-2", id));
    expect(closeCalls()).toEqual([["close_window", { label: "doc-2" }]]);

    mockInvoke.mockClear();
    bridge.label = "main";
    openTab("main", "/ws/other.md");
    const mainId = openTab("main", "/ws/b.md");
    mockInvoke.mockResolvedValueOnce("doc-4");
    await moveTabToNewWindow(args("main", mainId));
    expect(closeCalls()).toEqual([]);
  });

  it("a secondary window that still holds tabs stays open", async () => {
    bridge.label = "doc-2";
    openTab("doc-2", "/ws/keep.md");
    const id = openTab("doc-2", "/ws/a.md");
    mockInvoke.mockResolvedValueOnce("doc-3");

    await moveTabToNewWindow(args("doc-2", id));

    expect(closeCalls()).toEqual([]);
    expect(tabIds("doc-2")).toHaveLength(1);
  });
});

describe("moveTabToNewWindow — rollback when the window cannot be created", () => {
  it("leaves the tab and its document in the origin window, reports the failure, offers no Undo", async () => {
    openTab("main", "/ws/other.md");
    const id = openTab("main", "/ws/a.md", "unsaved edits");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce({ code: "internal", message: "window creation failed" });

    await moveTabToNewWindow(args("main", id));

    expect(tabIds("main")).toContain(id);
    expect(useDocumentStore.getState().getDocument(id)?.content).toBe("unsaved edits");
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(mockToast.message).not.toHaveBeenCalled();
    expect(closeCalls()).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("the tab is still the origin window's active tab afterwards", async () => {
    openTab("main", "/ws/other.md");
    const id = openTab("main", "/ws/a.md");
    useTabStore.getState().setActiveTab("main", id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("no window"));

    await moveTabToNewWindow(args("main", id));

    expect(useTabStore.getState().activeTabId.main).toBe(id);
  });
});
