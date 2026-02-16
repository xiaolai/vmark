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

vi.mock("@/hooks/closeSave", () => ({
  promptSaveForDirtyDocument: vi.fn(),
  promptSaveForMultipleDocuments: vi.fn(),
}));

vi.mock("@/hooks/workspaceSession", () => ({
  persistWorkspaceSession: vi.fn(() => Promise.resolve()),
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

describe("useWindowClose — menu:close", () => {
  beforeEach(() => {
    listeners.clear();
    resetStores();
    vi.clearAllMocks();
    // closeLog calls invoke("debug_log", ...) — must return a Promise
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("closes the active tab (not the window) on menu:close", async () => {
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
    // Importantly, invoke("close_window") should NOT have been called
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("ignores menu:close when targeted at a different window", async () => {
    const id = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(id, "", null);

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("menu:close")).toBe(true));

    await act(async () => {
      await listeners.get("menu:close")!({ payload: "other-window" });
    });

    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
  });

  it("does nothing on menu:close when no active tab", async () => {
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

  it("handles closeTabWithDirtyCheck rejection without unhandled error", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
    mockCloseTabWithDirtyCheck.mockRejectedValueOnce(new Error("save failed"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      render(<TestHarness />);
    });
    await waitFor(() => expect(listeners.has("menu:close")).toBe(true));

    // Should not throw — error is caught by the handler
    await act(async () => {
      await listeners.get("menu:close")!({ payload: WINDOW });
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "[WindowClose] menu:close tab close failed:",
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});
