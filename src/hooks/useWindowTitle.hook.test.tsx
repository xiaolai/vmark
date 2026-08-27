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

const state: { filePath: string | null; isDirty: boolean; hasActiveTab: boolean } = {
  filePath: "/docs/readme.md",
  isDirty: false,
  hasActiveTab: true,
};
vi.mock("./useDocumentState", () => ({
  useDocumentFilePath: () => state.filePath,
  useDocumentIsDirty: () => state.isDirty,
  useHasActiveTab: () => state.hasActiveTab,
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
  state.hasActiveTab = true;
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

// #1331 — closing the last tab leaves the window on the WelcomeScreen. The
// title kept reading the active document's `filePath`, which is null there for
// the same reason it is null for a genuinely untitled buffer — so the window
// announced a document that does not exist. On Linux and Windows that string is
// the visible title bar; on macOS it is the Window menu entry.
describe("useWindowTitle — no document open (WelcomeScreen)", () => {
  beforeEach(() => {
    state.hasActiveTab = false;
    state.filePath = null;
  });

  it("shows the product name instead of the untitled label", async () => {
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("VMark"));
    expect(setTitle).not.toHaveBeenCalledWith("Untitled");
  });

  it("shows the product name off macOS too", async () => {
    platform.overlayTitleBar = false;
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("VMark"));
  });

  // The setting still speaks for the whole title on macOS: an empty native
  // title is what keeps the window out of the Window menu, and "no document
  // open" is no reason to override a preference the user set.
  it("still honours the macOS show-filename setting", async () => {
    setShowFilename(false);
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith(""));
  });

  // A stale document flag cannot smuggle a bullet onto a title with no
  // document behind it.
  it("never prefixes a dirty indicator", async () => {
    state.isDirty = true;
    renderHook(() => useWindowTitle());
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("VMark"));
  });
});
