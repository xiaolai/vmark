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

const mockPromptSaveForDirtyDocument = vi.fn();
const mockPromptSaveForMultipleDocuments = vi.fn();
vi.mock("@/hooks/closeSave", () => ({
  promptSaveForDirtyDocument: (...args: unknown[]) =>
    mockPromptSaveForDirtyDocument(...args),
  promptSaveForMultipleDocuments: (...args: unknown[]) =>
    mockPromptSaveForMultipleDocuments(...args),
}));

const mockPersistWorkspaceSession = vi.fn(() => Promise.resolve());
vi.mock("@/hooks/workspaceSession", () => ({
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

    mockPromptSaveForDirtyDocument.mockResolvedValue({ action: "saved" });

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

    mockPromptSaveForMultipleDocuments.mockResolvedValue({ action: "saved" });

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

    mockPromptSaveForDirtyDocument.mockResolvedValue({ action: "saved" });

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

  it("skips duplicate quit-requested when already closing (lines 202-204)", async () => {
    // Create a dirty tab so handleCloseRequest blocks on the save prompt
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "dirty");

    // Make the save prompt hang so isClosingRef stays true
    let resolvePrompt!: (v: { action: string }) => void;
    mockPromptSaveForDirtyDocument.mockReturnValue(
      new Promise((resolve) => { resolvePrompt = resolve; })
    );

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("app:quit-requested")).toBe(true));

    // Fire first quit-requested — this starts handleCloseRequest and blocks
    const firstQuit = act(async () => {
      await listeners.get("app:quit-requested")!({ payload: WINDOW });
    });

    // Wait for the prompt to be called (isClosingRef is now true)
    await waitFor(() => expect(mockPromptSaveForDirtyDocument).toHaveBeenCalled());

    // Fire second quit-requested — should hit the isClosingRef guard (lines 202-204)
    await act(async () => {
      await listeners.get("app:quit-requested")!({ payload: WINDOW });
    });

    // The second call should NOT have triggered another save prompt
    expect(mockPromptSaveForDirtyDocument).toHaveBeenCalledTimes(1);

    // Resolve the hanging prompt so the test can finish
    resolvePrompt({ action: "saved" });
    await firstQuit;
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

  it("handles menu:close when no active tab", async () => {
    // No tabs created
    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("menu:close")).toBe(true));

    await act(async () => {
      await listeners.get("menu:close")!({ payload: WINDOW });
    });

    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
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

describe("useWindowClose — handleCloseRequest re-entry guard (lines 74-76)", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("ignores duplicate close-requested while first is still processing", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "dirty");

    // Make the save prompt hang
    let resolvePrompt!: (v: { action: string }) => void;
    mockPromptSaveForDirtyDocument.mockReturnValue(
      new Promise((resolve) => { resolvePrompt = resolve; })
    );

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    // First close-requested — blocks on save prompt
    const first = act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    await waitFor(() => expect(mockPromptSaveForDirtyDocument).toHaveBeenCalled());

    // Second close-requested — should be ignored (isClosingRef is true, lines 74-76)
    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    // Only one prompt should have been shown
    expect(mockPromptSaveForDirtyDocument).toHaveBeenCalledTimes(1);

    // Resolve to unblock
    resolvePrompt({ action: "saved" });
    await first;
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

describe("useWindowClose — dirtyContexts filter when doc becomes clean (line 113)", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("filters out tab whose doc becomes clean between dirty check and context build", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "dirty");

    // Mock multi-doc prompt in case it's reached (empty array)
    mockPromptSaveForMultipleDocuments.mockResolvedValue({ action: "discard" });

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    // Spy on getDocument — first call (filter, line 93) returns dirty doc,
    // second call (map, line 112) returns doc with isDirty=false.
    const realGetState = useDocumentStore.getState.bind(useDocumentStore);
    let getDocCallCount = 0;
    const getStateSpy = vi.spyOn(useDocumentStore, "getState").mockImplementation(() => {
      const real = realGetState();
      return {
        ...real,
        getDocument: (id: string) => {
          getDocCallCount++;
          const doc = real.getDocument(id);
          if (!doc) return undefined;
          // First call: return dirty (for filter at line 93)
          // Second call: return clean (for map at line 112) — triggers line 113
          if (getDocCallCount >= 2 && id === tabId) {
            return { ...doc, isDirty: false };
          }
          return doc;
        },
      };
    });

    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    getStateSpy.mockRestore();

    // dirtyContexts should be empty after filtering null, so promptSaveForMultipleDocuments
    // is called with empty array (or single-doc prompt is not called)
    expect(mockPromptSaveForDirtyDocument).not.toHaveBeenCalled();
  });
});
