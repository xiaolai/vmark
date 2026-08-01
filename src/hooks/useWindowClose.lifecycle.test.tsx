/**
 * useWindowClose — lifecycle contracts added for WI-1/WI-3/WI-7/WI-8g. Own
 * file: the comprehensive suite sits at the test-size limit.
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

const mockCloseTabWithDirtyCheck = vi.fn(() => Promise.resolve(true));
vi.mock("@/hooks/useTabOperations", () => ({
  closeTabWithDirtyCheck: () => mockCloseTabWithDirtyCheck(),
}));

const mockCleanupOrphansForClosingTabs = vi.fn((_tabIds: string[]) => Promise.resolve());
vi.mock("@/services/media/closeCleanup", () => ({
  cleanupOrphansForClosingTabs: (tabIds: string[]) => mockCleanupOrphansForClosingTabs(tabIds),
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
    (mockPromptSaveForDirtyDocument as (...a: unknown[]) => unknown)(...args),
  promptSaveForMultipleDocuments: (...args: unknown[]) =>
    (mockPromptSaveForMultipleDocuments as (...a: unknown[]) => unknown)(...args),
}));

const mockPersistWorkspaceSession = vi.fn(() => Promise.resolve());
vi.mock("@/services/workspaces/workspaceSession", () => ({
  persistWorkspaceSession: (...args: unknown[]) => mockPersistWorkspaceSession(...args),
}));

const mockAsk = vi.fn(() => Promise.resolve(true));
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

describe("useWindowClose — concurrent close requests join (WI-1/WI-7 shape)", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("a duplicate close-requested joins the in-flight close: one prompt, one close", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "initial", null);
    useDocumentStore.getState().setContent(tabId, "dirty");

    let resolvePrompt!: (v: { action: string }) => void;
    mockPromptSaveForDirtyDocument.mockImplementation((ctx) =>
      new Promise((resolve) => {
        resolvePrompt = (v) => {
          if (v.action === "saved") settleDoc(ctx);
          resolve(v);
        };
      })
    );

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));

    const first = listeners.get("window:close-requested")!({ payload: WINDOW });
    const second = listeners.get("window:close-requested")!({ payload: WINDOW });
    await waitFor(() => expect(mockPromptSaveForDirtyDocument).toHaveBeenCalledTimes(1));

    resolvePrompt({ action: "saved" });
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(mockPromptSaveForDirtyDocument).toHaveBeenCalledTimes(1);
    // One close, not two: close_window invoked exactly once.
    const closes = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "close_window");
    expect(closes).toHaveLength(1);
  });
});

// WI-3 — a failed native close must leave the window USABLE. The old order
// erased every document, tab and pane before invoking close_window, so a
// rejection left a live window whose contents no longer existed.
describe("useWindowClose — nothing is destroyed until the native close succeeds", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("keeps documents, tabs and panes intact when close_window rejects", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "A", "/tmp/a.md");

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "close_window") throw new Error("native close failed");
      return undefined;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));
    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    // The window survives WITH its state — not alive-but-empty.
    expect(useTabStore.getState().tabs[WINDOW]).toHaveLength(1);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
    errorSpy.mockRestore();
  });

  it("keeps state intact when session persistence rejects", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "A", "/tmp/a.md");
    mockPersistWorkspaceSession.mockRejectedValueOnce(new Error("disk full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("window:close-requested")).toBe(true));
    await act(async () => {
      await listeners.get("window:close-requested")!({ payload: WINDOW });
    });

    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
    expect(useTabStore.getState().tabs[WINDOW]).toHaveLength(1);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
    errorSpy.mockRestore();
  });
});

// WI-8g — a listener whose registration resolves AFTER unmount must be
// unregistered on the spot, or React Strict Mode's first mount leaks its
// listeners for the lifetime of the window.
describe("useWindowClose — listener registration resolving after unmount", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("unregisters late-resolving listeners immediately", async () => {
    const lateUnlisten = vi.fn();
    let resolveListen!: (fn: () => void) => void;
    const webviewModule = await import("@tauri-apps/api/webviewWindow");
    const spy = vi
      .spyOn(webviewModule, "getCurrentWebviewWindow")
      .mockReturnValue({
        label: WINDOW,
        listen: vi.fn(
          () => new Promise<() => void>((resolve) => { resolveListen = resolve; }),
        ),
      } as never);

    const { unmount } = render(<TestHarness />);
    unmount();

    // Registration completes only AFTER the unmount.
    resolveListen(lateUnlisten);
    await waitFor(() => expect(lateUnlisten).toHaveBeenCalled());
    spy.mockRestore();
  });
});
