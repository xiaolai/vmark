/**
 * useWindowTitle — hook behaviour.
 *
 * Separate from `useWindowTitle.test.ts`, which is a node-environment suite for
 * the pure formatters and must stay that way: rendering a hook needs a DOM.
 *
 * The failure path is the reason this file exists. `window.setTitle` is IPC and
 * can reject; the hook marks that call `void ... .catch(...)`, and without a
 * test the catch arm is a promise nobody proves is wired — exactly the shape
 * that used to end as an unhandled rejection naming no caller.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const setTitle = vi.fn<(t: string) => Promise<void>>();
const titleBarWarn = vi.fn();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ setTitle }),
}));
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titleBarWarn: (...args: unknown[]) => titleBarWarn(...args),
}));

const state: { filePath: string | null; isDirty: boolean } = {
  filePath: "/docs/readme.md",
  isDirty: false,
};
vi.mock("./useDocumentState", () => ({
  useDocumentFilePath: () => state.filePath,
  useDocumentIsDirty: () => state.isDirty,
}));

// The native title's audience is platform-dependent (#1296): on macOS it is
// hidden behind the app's own chrome strip, everywhere else it IS the title bar.
const platform = vi.hoisted(() => ({ overlayTitleBar: true }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  usesOverlayTitleBar: () => platform.overlayTitleBar,
}));

const { useSettingsStore } = await import("@/stores/settingsStore");
const { useWindowTitle } = await import("./useWindowTitle");

beforeEach(() => {
  setTitle.mockReset().mockResolvedValue(undefined);
  titleBarWarn.mockReset();
  platform.overlayTitleBar = true;
  state.filePath = "/docs/readme.md";
  state.isDirty = false;
  useSettingsStore.setState((s) => ({
    appearance: { ...s.appearance, showFilenameInTitlebar: true },
  }));
});

const setShowFilename = (show: boolean) =>
  useSettingsStore.setState((s) => ({
    appearance: { ...s.appearance, showFilenameInTitlebar: show },
  }));

describe("useWindowTitle", () => {
  it("sets the native title and the document title from the file path", async () => {
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("readme.md"));
    // document.title drops the extension for cleaner print-to-PDF naming.
    expect(document.title).toBe("readme");
    expect(titleBarWarn).not.toHaveBeenCalled();
  });

  it("prefixes the dirty indicator", async () => {
    state.isDirty = true;
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("• readme.md"));
  });

  it("clears the native title when the filename is not shown", async () => {
    setShowFilename(false);
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith(""));
  });

  it("reports a setTitle rejection instead of dropping it", async () => {
    const boom = new Error("ipc down");
    setTitle.mockRejectedValueOnce(boom);
    renderHook(() => useWindowTitle());
    await waitFor(() =>
      expect(titleBarWarn).toHaveBeenCalledWith("Failed to set window title:", boom)
    );
  });

  it("localises the fallback name for an unsaved document", async () => {
    state.filePath = null;
    renderHook(() => useWindowTitle());
    // The literal used to be hardcoded English. It reached the native title bar
    // on every locale — and off macOS that title bar is always visible (#1296).
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("Untitled"));
  });
});

// #1296 — the setting exists because macOS HIDES the native title behind the
// app's own chrome. Off macOS the native title bar is the only place a filename
// can appear, so the preference has no meaning there and must not be honoured.
describe("useWindowTitle — off macOS the native title is not optional", () => {
  beforeEach(() => {
    platform.overlayTitleBar = false;
  });

  it("shows the filename even with the macOS-only setting off", async () => {
    setShowFilename(false);
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("readme.md"));
  });

  it("never clears the native title", async () => {
    setShowFilename(false);
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalled());
    expect(setTitle).not.toHaveBeenCalledWith("");
  });

  it("still carries the dirty indicator", async () => {
    setShowFilename(false);
    state.isDirty = true;
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("• readme.md"));
  });

  it("falls back to the localised untitled name with no file", async () => {
    setShowFilename(false);
    state.filePath = null;
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("Untitled"));
  });
});
