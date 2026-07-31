/**
 * Comprehensive tests for useWindowClose hook
 *
 * Tests window close-requested handling, quit-requested, dirty document
 * prompts, workspace session persistence, and re-entry guard.
 */

import { render, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

type EventHandler = (event: { payload: string }) => void | Promise<void>;
const listeners = new Map<string, EventHandler>();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    listen: vi.fn((eventName: string, handler: EventHandler) => {
      listeners.set(eventName, handler);
      return Promise.resolve(() => {});
    }),
  }),
}));

const mockCloseTabWithDirtyCheck = vi.fn(
  (_windowLabel: string, _tabId: string) => Promise.resolve(true)
);
vi.mock("@/hooks/useTabOperations", () => ({
  closeTabWithDirtyCheck: (windowLabel: string, tabId: string) =>
    mockCloseTabWithDirtyCheck(windowLabel, tabId),
}));

const mockCleanupOrphansForClosingTabs = vi.fn((_tabIds: string[]) => Promise.resolve());
vi.mock("@/services/media/closeCleanup", () => ({
  cleanupOrphansForClosingTabs: (tabIds: string[]) =>
    mockCleanupOrphansForClosingTabs(tabIds),
}));

/** Mirror the real prompt: "saved" means the doc was actually saved. */
const settleDoc = (ctx: { tabId: string; content: string }) =>
  useDocumentStore.getState().markSaved(ctx.tabId, ctx.content);
const mockPromptSaveForDirtyDocument = vi.fn(async (ctx: { tabId: string; content: string }) => {
  settleDoc(ctx);
  return { action: "saved" as const };
});
const mockPromptSaveForMultipleDocuments = vi.fn(
  async (ctxs: Array<{ tabId: string; content: string }>) => {
    ctxs.forEach(settleDoc);
    return { action: "saved-all" as const };
  },
);
vi.mock("@/hooks/closeSave", () => ({
  promptSaveForDirtyDocument: (...args: unknown[]) =>
    mockPromptSaveForDirtyDocument(...args),
  promptSaveForMultipleDocuments: (...args: unknown[]) =>
    mockPromptSaveForMultipleDocuments(...args),
}));

const mockPersistWorkspaceSession = vi.fn(() => Promise.resolve());
vi.mock("@/services/workspaces/workspaceSession", () => ({
  persistWorkspaceSession: (...args: unknown[]) =>
    mockPersistWorkspaceSession(...args),
}));

const mockAsk = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => mockAsk(...args),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

import { useWindowClose } from "./useWindowClose";

const WINDOW = "main";

function TestHarness() {
  useWindowClose();
  return null;
}

function resetStores() {
  useTabStore.getState().removeWindow(WINDOW);
  Object.keys(useDocumentStore.getState().documents).forEach((id) =>
    useDocumentStore.getState().removeDocument(id)
  );
}

describe("useWindowClose — window:close-requested", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("registers event listeners", async () => {
    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => {
      expect(listeners.has("menu:close")).toBe(true);
      expect(listeners.has("window:close-requested")).toBe(true);
      expect(listeners.has("app:quit-requested")).toBe(true);
    });
  });

  it("closes window with no tabs (no dirty check needed)", async () => {
    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(mockPersistWorkspaceSession).toHaveBeenCalledWith(WINDOW);
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("closes window with clean tabs (no dirty documents)", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    // isDirty should be false for a fresh document

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("prompts save for a single dirty document", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "modified");

    mockPromptSaveForDirtyDocument.mockImplementation(async (ctx) => {
      settleDoc(ctx);
      return { action: "saved" as const };
    });

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(mockPromptSaveForDirtyDocument).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("does not close when single dirty save is cancelled", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "modified");

    mockPromptSaveForDirtyDocument.mockResolvedValue({ action: "cancelled" });

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("prompts multi-save for multiple dirty documents", async () => {
    const tab1 = useTabStore.getState().createTab(WINDOW, null);
    const tab2 = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tab1, "initial1", null);
    useDocumentStore.getState().initDocument(tab2, "initial2", null);
    useDocumentStore.getState().setContent(tab1, "dirty1");
    useDocumentStore.getState().setContent(tab2, "dirty2");

    mockPromptSaveForMultipleDocuments.mockImplementation(async (ctxs) => {
      ctxs.forEach(settleDoc);
      return { action: "saved-all" as const };
    });

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(mockPromptSaveForMultipleDocuments).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("does not close when multi-save is cancelled", async () => {
    const tab1 = useTabStore.getState().createTab(WINDOW, null);
    const tab2 = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tab1, "initial1", null);
    useDocumentStore.getState().initDocument(tab2, "initial2", null);
    useDocumentStore.getState().setContent(tab1, "dirty1");
    useDocumentStore.getState().setContent(tab2, "dirty2");

    mockPromptSaveForMultipleDocuments.mockResolvedValue({ action: "cancelled" });

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("ignores close-requested for a different window", async () => {
    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: "other-window" });
    });

    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("cleans up documents on close", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "content", null);

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    // Document should be removed
    expect(useDocumentStore.getState().getDocument(tabId)).toBeUndefined();
  });

  it("does NOT prompt for pinned tabs when no tab is pinned", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(mockAsk).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("prompts pinned-tabs confirmation and closes when user confirms", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    useTabStore.getState().togglePin(WINDOW, tabId);

    mockAsk.mockResolvedValue(true);

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("does NOT close when pinned-tabs confirmation is cancelled", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    useTabStore.getState().togglePin(WINDOW, tabId);

    mockAsk.mockResolvedValue(false);

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
    expect(mockPersistWorkspaceSession).not.toHaveBeenCalled();
  });

  it("does NOT show pinned-tabs prompt when a tab is also dirty (save dialog handles intent)", async () => {
    const pinnedTab = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(pinnedTab, "initial", null);
    useTabStore.getState().togglePin(WINDOW, pinnedTab);
    useDocumentStore.getState().setContent(pinnedTab, "dirty");

    mockPromptSaveForDirtyDocument.mockImplementation(async (ctx) => {
      settleDoc(ctx);
      return { action: "saved" as const };
    });

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(mockAsk).not.toHaveBeenCalled();
    expect(mockPromptSaveForDirtyDocument).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });
});

describe("useWindowClose — app:quit-requested", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("closes window on quit request", async () => {
    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("app:quit-requested")).toBe(true));

    await act(async () => {
      await listeners.get("app:quit-requested")!({ payload: WINDOW });
    });

    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("calls cancel_quit when close is cancelled", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "dirty");

    mockPromptSaveForDirtyDocument.mockResolvedValue({ action: "cancelled" });

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("app:quit-requested")).toBe(true));

    await act(async () => {
      await listeners.get("app:quit-requested")!({ payload: WINDOW });
    });

    expect(invoke).toHaveBeenCalledWith("cancel_quit");
  });

  // WI-1: a second quit event JOINS the in-flight close — and however many
  // events join, Rust is answered with cancel_quit exactly ONCE per attempt.
  // The old boolean guard returned without answering at all, leaving
  // quit_in_progress set and Cmd+Q dead for the rest of the session.
  it("joins an in-flight close and answers Rust exactly once", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "dirty");

    let resolvePrompt!: (v: { action: string }) => void;
    mockPromptSaveForDirtyDocument.mockReturnValue(
      new Promise((resolve) => { resolvePrompt = resolve; })
    );

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("app:quit-requested")).toBe(true));

    // Two quit events while the prompt hangs — both must JOIN one close.
    const quit1 = listeners.get("app:quit-requested")!({ payload: WINDOW });
    const quit2 = listeners.get("app:quit-requested")!({ payload: WINDOW });
    await waitFor(() => expect(mockPromptSaveForDirtyDocument).toHaveBeenCalledTimes(1));

    // The user cancels the close.
    resolvePrompt({ action: "cancelled" });
    await act(async () => {
      await Promise.all([quit1, quit2]);
    });

    // One prompt, and exactly ONE cancel_quit despite two joined quit events.
    expect(mockPromptSaveForDirtyDocument).toHaveBeenCalledTimes(1);
    const cancelQuits = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "cancel_quit");
    expect(cancelQuits).toHaveLength(1);
  });

  // WI-1, the reported shape: the close was started by the TRAFFIC LIGHT, quit
  // arrives mid-flight, the user cancels — quit must still be answered.
  it("answers cancel_quit for a close another trigger started", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "dirty");

    let resolvePrompt!: (v: { action: string }) => void;
    mockPromptSaveForDirtyDocument.mockReturnValue(
      new Promise((resolve) => { resolvePrompt = resolve; })
    );

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("app:quit-requested")).toBe(true));

    // Traffic light starts the close…
    const closeReq = listeners.get("window:close-requested")!({ payload: WINDOW });
    await waitFor(() => expect(mockPromptSaveForDirtyDocument).toHaveBeenCalledTimes(1));
    // …then Cmd+Q lands while the prompt is open.
    const quit = listeners.get("app:quit-requested")!({ payload: WINDOW });

    resolvePrompt({ action: "cancelled" });
    await act(async () => {
      await Promise.all([closeReq, quit]);
    });

    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "cancel_quit")).toHaveLength(1);
  });

  it("handles cancel_quit invoke rejection (lines 210-211)", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "dirty");

    mockPromptSaveForDirtyDocument.mockResolvedValue({ action: "cancelled" });

    // Make cancel_quit reject
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "cancel_quit") throw new Error("cancel_quit failed");
      return undefined;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("app:quit-requested")).toBe(true));

    await act(async () => {
      await listeners.get("app:quit-requested")!({ payload: WINDOW });
    });

    // cancel_quit was called and rejected — the catch block ran (lines 210-211)
    expect(invoke).toHaveBeenCalledWith("cancel_quit");
    warnSpy.mockRestore();
  });

  it("ignores quit request for a different window", async () => {
    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("app:quit-requested")).toBe(true));

    await act(async () => {
      await listeners.get("app:quit-requested")!({ payload: "other-window" });
    });

    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });
});

describe("useWindowClose — menu:close", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("closes active tab via closeTabWithDirtyCheck on menu:close", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("menu:close")).toBe(true));

    await act(async () => {
      await listeners.get("menu:close")!({ payload: WINDOW });
    });

    expect(mockCloseTabWithDirtyCheck).toHaveBeenCalledWith(WINDOW, tabId);
  });

  it("ignores menu:close for a different window", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("menu:close")).toBe(true));

    await act(async () => {
      await listeners.get("menu:close")!({ payload: "other-window" });
    });

    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
  });

  it("closes the empty window on menu:close when no active tab (Welcome screen)", async () => {
    // No tabs: the window is on the Welcome screen. Cmd+W should close the
    // window itself (not a tab) so the persistent empty window stays closeable
    // from the keyboard.
    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("menu:close")).toBe(true));

    await act(async () => {
      await listeners.get("menu:close")!({ payload: WINDOW });
    });

    // Not routed through the tab-close path...
    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
    // ...instead the window-close request runs.
    expect(mockPersistWorkspaceSession).toHaveBeenCalledWith(WINDOW);
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("catches closeTabWithDirtyCheck error gracefully", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    mockCloseTabWithDirtyCheck.mockRejectedValueOnce(new Error("fail"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("menu:close")).toBe(true));

    await act(async () => {
      await listeners.get("menu:close")!({ payload: WINDOW });
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "[WindowClose]",
      "menu:close tab close failed:",
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});

describe("useWindowClose — closeLog debug_log catch (line 50)", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
  });

  it("catches debug_log invoke failure and warns", async () => {
    // Make debug_log reject, but all other invokes succeed
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "debug_log") throw new Error("debug_log failed");
      return undefined;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => {
      render(<TestHarness />);
    });
    // The setup() function calls closeLog which invokes debug_log
    // Wait for the catch to process
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    // Give time for the catch handler to run (it's async fire-and-forget)
    await new Promise((r) => setTimeout(r, 50));

    expect(warnSpy).toHaveBeenCalledWith(
      "[WindowClose]",
      "debug_log invoke failed:",
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });
});

describe("useWindowClose — handleCloseRequest catch block (lines 144-146)", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("catches and logs error when persistWorkspaceSession throws", async () => {
    // Clean tabs (no dirty) so it goes straight to persistWorkspaceSession
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    mockPersistWorkspaceSession.mockRejectedValueOnce(new Error("persist error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "[WindowClose]",
      "Failed to close window:",
      expect.any(Error)
    );
    // close_window should NOT have been called since the error was caught
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
    consoleSpy.mockRestore();
  });
});

describe("useWindowClose — orphan image cleanup", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  async function renderAndFire(event: string) {
    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has(event)).toBe(true));
    await act(async () => {
      await listeners.get(event)!({ payload: WINDOW });
    });
  }

  it("cleans up orphans for every tab before closing a window with no dirty docs", async () => {
    const a = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    const b = useTabStore.getState().createTab(WINDOW, "/tmp/b.md");
    useDocumentStore.getState().initDocument(a, "A", "/tmp/a.md");
    useDocumentStore.getState().initDocument(b, "B", "/tmp/b.md");

    await renderAndFire("window:close-requested");

    expect(mockCleanupOrphansForClosingTabs).toHaveBeenCalledWith([a, b]);
    expect(invoke).toHaveBeenCalledWith("close_window", { label: WINDOW });
  });

  it("cleans up after the save prompt resolves, so it scans the saved content", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "initial", "/tmp/a.md");
    useDocumentStore.getState().setContent(tabId, "modified");

    const order: string[] = [];
    mockPromptSaveForDirtyDocument.mockImplementation(async (ctx) => {
      order.push("prompt");
      settleDoc(ctx); // the real prompt saves — leaving it dirty would (rightly) re-prompt
      return { action: "saved" };
    });
    mockCleanupOrphansForClosingTabs.mockImplementation(async () => {
      order.push("cleanup");
    });

    await renderAndFire("window:close-requested");

    expect(order).toEqual(["prompt", "cleanup"]);
    expect(mockCleanupOrphansForClosingTabs).toHaveBeenCalledWith([tabId]);
  });

  it("cleans up on app quit", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "A", "/tmp/a.md");

    await renderAndFire("app:quit-requested");

    expect(mockCleanupOrphansForClosingTabs).toHaveBeenCalledWith([tabId]);
  });

  it("cleans up BEFORE the documents are dropped from the store", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "A", "/tmp/a.md");

    let docStillPresent: boolean | null = null;
    mockCleanupOrphansForClosingTabs.mockImplementation(async () => {
      docStillPresent = Boolean(useDocumentStore.getState().getDocument(tabId));
    });

    await renderAndFire("window:close-requested");

    // Cleanup reads the document's content and path — running it after
    // removeDocument would leave it with nothing to scan.
    expect(docStillPresent).toBe(true);
  });

  it("does not clean up when the user cancels the close", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "initial", "/tmp/a.md");
    useDocumentStore.getState().setContent(tabId, "modified");

    mockPromptSaveForDirtyDocument.mockResolvedValue({ action: "cancelled" });

    await renderAndFire("window:close-requested");

    expect(mockCleanupOrphansForClosingTabs).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });
});
