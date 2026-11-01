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
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const setTitle = vi.fn<(t: string) => Promise<void>>();
const titleBarWarn = vi.fn();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ setTitle }),
}));
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titleBarWarn: (...args: unknown[]) => titleBarWarn(...args),
}));

// The document the window shows, seeded into the REAL tab and document stores
// by `renderTitle` — the hook reads them through the real selectors.
const state: { filePath: string | null; isDirty: boolean; hasActiveTab: boolean } = {
  filePath: "/docs/readme.md",
  isDirty: false,
  hasActiveTab: true,
};

// The native title is always the document's name, but its audience differs
// (#1296, #1618): on macOS the title bar text is hidden and the Dock, Window menu
// and Mission Control read it; everywhere else it IS the title bar.
const platform = vi.hoisted(() => ({ overlayTitleBar: true }));
vi.mock("@/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/platform")>()),
  usesOverlayTitleBar: () => platform.overlayTitleBar,
}));

const { useSettingsStore } = await import("@/stores/settingsStore");
const { useTabStore } = await import("@/stores/tabStore");
const { useDocumentStore } = await import("@/stores/documentStore");
const { WindowContext } = await import("@/contexts/WindowContext");
const { useWindowTitle } = await import("./useWindowTitle");

const WINDOW = "main";

function seedWindow() {
  useTabStore.getState().removeWindow(WINDOW);
  for (const id of Object.keys(useDocumentStore.getState().documents)) {
    useDocumentStore.getState().removeDocument(id);
  }
  if (!state.hasActiveTab) return;
  const tabId = useTabStore.getState().createTab(WINDOW, state.filePath);
  useDocumentStore.getState().initDocument(tabId, "body", state.filePath);
  if (state.isDirty) useDocumentStore.getState().setEditorContent(tabId, "body, edited");
}

function renderTitle() {
  seedWindow();
  return renderHook(() => useWindowTitle(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <WindowContext.Provider value={{ windowLabel: WINDOW, isDocumentWindow: true }}>
        {children}
      </WindowContext.Provider>
    ),
  });
}

beforeEach(() => {
  setTitle.mockReset().mockResolvedValue(undefined);
  titleBarWarn.mockReset();
  platform.overlayTitleBar = true;
  state.filePath = "/docs/readme.md";
  state.isDirty = false;
  state.hasActiveTab = true;
  useSettingsStore.setState((s) => ({
    appearance: { ...s.appearance, showFilenameInTitlebar: true, showFolderInWindowTitle: false },
  }));
});

const setShowFilename = (show: boolean) =>
  useSettingsStore.setState((s) => ({
    appearance: { ...s.appearance, showFilenameInTitlebar: show },
  }));

const setShowFolder = (show: boolean) =>
  useSettingsStore.setState((s) => ({
    appearance: { ...s.appearance, showFolderInWindowTitle: show },
  }));

describe("useWindowTitle", () => {
  it("sets the native title and the document title from the file path", async () => {
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("readme.md"));
    // document.title drops the extension for cleaner print-to-PDF naming.
    expect(document.title).toBe("readme");
    expect(titleBarWarn).not.toHaveBeenCalled();
  });

  it("prefixes the dirty indicator", async () => {
    state.isDirty = true;
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("• readme.md"));
  });

  // #1618 — the setting governs the app's own strip. The Dock, Window menu and
  // Mission Control read the native title, and fall back to "VMark" without it.
  it("names the document natively on macOS with the titlebar filename off", async () => {
    setShowFilename(false);
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("readme.md"));
    expect(setTitle).not.toHaveBeenCalledWith("");
  });

  it("adds the parent folder on macOS when asked to", async () => {
    setShowFolder(true);
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("docs | readme.md"));
    // The print-to-PDF name stays the bare document name.
    expect(document.title).toBe("readme");
  });

  it("retitles when the folder setting flips", async () => {
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("readme.md"));
    act(() => setShowFolder(true));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("docs | readme.md"));
    act(() => setShowFolder(false));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("readme.md"));
  });

  it("reports a setTitle rejection instead of dropping it", async () => {
    const boom = new Error("ipc down");
    setTitle.mockRejectedValueOnce(boom);
    renderTitle();
    await waitFor(() =>
      expect(titleBarWarn).toHaveBeenCalledWith("Failed to set window title:", boom)
    );
  });

  it("localises the fallback name for an unsaved document", async () => {
    state.filePath = null;
    renderTitle();
    // The literal used to be hardcoded English. It reached the native title bar
    // on every locale — and off macOS that title bar is always visible (#1296).
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("Untitled"));
  });
});

// #1296 — both settings are macOS-only. Off macOS the native title bar is the
// visible title, and neither toggle is offered there, so a value that a synced
// settings file carries across platforms must not change it.
describe("useWindowTitle — off macOS the native title ignores the macOS settings", () => {
  beforeEach(() => {
    platform.overlayTitleBar = false;
  });

  it("shows the filename even with the macOS-only setting off", async () => {
    setShowFilename(false);
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("readme.md"));
  });

  it("never clears the native title", async () => {
    setShowFilename(false);
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalled());
    expect(setTitle).not.toHaveBeenCalledWith("");
  });

  it("does not add the folder", async () => {
    setShowFolder(true);
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("readme.md"));
  });

  it("still carries the dirty indicator", async () => {
    setShowFilename(false);
    state.isDirty = true;
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("• readme.md"));
  });

  it("falls back to the localised untitled name with no file", async () => {
    setShowFilename(false);
    state.filePath = null;
    renderTitle();
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
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("VMark"));
    expect(setTitle).not.toHaveBeenCalledWith("Untitled");
  });

  it("shows the product name off macOS too", async () => {
    platform.overlayTitleBar = false;
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("VMark"));
  });

  it("keeps the product name with the titlebar filename off on macOS", async () => {
    setShowFilename(false);
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("VMark"));
  });

  it("has no folder to add to the product name", async () => {
    setShowFolder(true);
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("VMark"));
  });

  // A stale document flag cannot smuggle a bullet onto a title with no
  // document behind it.
  it("never prefixes a dirty indicator", async () => {
    state.isDirty = true;
    renderTitle();
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith("VMark"));
  });
});
