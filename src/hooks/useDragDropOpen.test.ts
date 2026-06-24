/**
 * Tests for useDragDropOpen's internal `openFileInNewTab` helper.
 *
 * The Tauri drag-drop event pipeline is deliberately out of scope here —
 * these tests exercise the size-tier routing that was missed in the
 * original audit-fix run.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockReadTextFile = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockAsk = vi.fn(() => Promise.resolve(true));
const mockMessage = vi.fn(() => Promise.resolve(undefined));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => mockAsk(...args),
  message: (...args: unknown[]) => mockMessage(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: () => ({ kind: "lf" }),
}));

let dragDropHandler: ((event: {
  payload: { type: string; paths: string[] };
}) => Promise<void> | void) | null = null;
const mockOnDragDropEvent = vi.fn((handler: typeof dragDropHandler) => {
  dragDropHandler = handler;
  return Promise.resolve(() => {});
});
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mockOnDragDropEvent }),
}));

vi.mock("@/hooks/useReplaceableTab", () => ({
  getReplaceableTab: () => null,
  findExistingTabForPath: () => null,
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

import { __testing__, useDragDropOpen } from "./useDragDropOpen";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { useFileLoadStore } from "@/stores/documentStore";

const { openFileInNewTab } = __testing__;
const WINDOW = "main";

describe("useDragDropOpen.openFileInNewTab — size-tier routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dragDropHandler = null;
    useSettingsStore.getState().resetSettings();
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
    useFileLoadStore.getState().endLoad();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
    mockAsk.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue("# content");
  });

  it("small files read and initialize the document normally", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(10_000);
      return Promise.resolve(null);
    });

    await openFileInNewTab(WINDOW, "/docs/small.md");

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/small.md");
    expect(useLargeFileSessionStore.getState().forcedSourceTabs).toEqual({});
  });

  it("large files (≥ 1 MB) force Source mode and mark the tab", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(2 * 1024 * 1024);
      return Promise.resolve(null);
    });

    await openFileInNewTab(WINDOW, "/docs/large.md");

    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/large.md");
    const marks = Object.keys(useLargeFileSessionStore.getState().forcedSourceTabs);
    expect(marks.length).toBe(1);
  });

  it("huge files (≥ 5 MB) confirm before reading; cancel aborts the open", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(10 * 1024 * 1024);
      return Promise.resolve(null);
    });
    mockAsk.mockResolvedValueOnce(false);

    await openFileInNewTab(WINDOW, "/docs/huge.md");

    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("refused files (≥ 50 MB) never read or create a tab", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(60 * 1024 * 1024);
      return Promise.resolve(null);
    });

    await openFileInNewTab(WINDOW, "/docs/refused.md");

    expect(mockReadTextFile).not.toHaveBeenCalled();
    expect(mockMessage).toHaveBeenCalled();
  });

  it("sets an indeterminate indicator for ≥ 300 KB WYSIWYG opens", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(400 * 1024);
      return Promise.resolve(null);
    });

    // Peek at the store synchronously after the indicator is set. We do this
    // mid-await by starting the open then asserting the store state before
    // the promise resolves — but since the indicator is set before the await
    // on readTextFile, the assertion can run after open too (endLoad is
    // lazy on the editor mount, which does not happen in this test).
    const promise = openFileInNewTab(WINDOW, "/docs/medium.md");
    await promise;

    // After the open, the indicator should still be active because no editor
    // mount occurs in this unit test — only the error path clears it.
    expect(useFileLoadStore.getState().active).toBe(true);
  });

  it("read failure for a medium file clears the indicator in the error path", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(400 * 1024);
      return Promise.resolve(null);
    });
    mockReadTextFile.mockRejectedValueOnce(new Error("permission denied"));

    await openFileInNewTab(WINDOW, "/docs/medium-fail.md");

    expect(useFileLoadStore.getState().active).toBe(false);
  });

  it("does not mark forced-source when autoSourceMode is off", async () => {
    useSettingsStore.getState().updateLargeFileSetting("autoSourceMode", false);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(2 * 1024 * 1024);
      return Promise.resolve(null);
    });

    await openFileInNewTab(WINDOW, "/docs/large.md");

    expect(useLargeFileSessionStore.getState().forcedSourceTabs).toEqual({});
  });

  it("keeps dropped files in the current workbench in rail mode even with dirty tabs", async () => {
    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", true);
    const dirtyTabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(dirtyTabId, "dirty", null);
    useDocumentStore.getState().setContent(dirtyTabId, "dirty changed");
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(10_000);
      return Promise.resolve(null);
    });

    renderHook(() => useDragDropOpen());
    await waitFor(() => expect(mockOnDragDropEvent).toHaveBeenCalled());
    await act(async () => {
      await dragDropHandler?.({
        payload: { type: "drop", paths: ["/outside/a.md"] },
      });
    });

    expect(useTabStore.getState().getTabsByWindow(WINDOW).map((tab) => tab.filePath))
      .toContain("/outside/a.md");
    expect(mockReadTextFile).toHaveBeenCalledWith("/outside/a.md");
    expect(mockInvoke.mock.calls.some(([cmd]) =>
      cmd === "open_file_in_new_window" ||
      cmd === "open_workspace_with_files_in_new_window"
    )).toBe(false);
  });
});
