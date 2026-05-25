/**
 * Tests for useTabShortcuts — status bar toggle and non-document window guard.
 */

import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";

// Track calls
const mockCloseTabWithDirtyCheck = vi.fn(() => Promise.resolve(true));
vi.mock("@/hooks/useTabOperations", () => ({
  closeTabWithDirtyCheck: (w: string, t: string) => mockCloseTabWithDirtyCheck(w, t),
}));

// IME guard — controlled per test
let imeResult = false;
vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: () => imeResult,
}));

// Shortcut matching — match only the statusBar shortcut key
let matchTarget: string | null = null;
vi.mock("@/utils/shortcutMatch", () => ({
  isMacPlatform: () => true,
  matchesShortcutEvent: (_e: KeyboardEvent, key: string) => {
    return matchTarget !== null && key === matchTarget;
  },
}));

// Mock shortcutsStore to return known shortcut keys
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ markdown: {} }), subscribe: () => () => {} },
  useShortcutsStore: {
    getState: () => ({
      getShortcut: (id: string) => {
        if (id === "newTab") return "Mod-t";
        if (id === "toggleStatusBar") return "F7";
        return "";
      },
    }),
  },
}));

// Context mock — controlled per test
let isDocWindow = true;
let windowLbl = "main";
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => windowLbl,
  useIsDocumentWindow: () => isDocWindow,
}));

import { useTabShortcuts } from "./useTabShortcuts";

const WINDOW = "main";

function TestHarness() {
  useTabShortcuts();
  return null;
}

function resetStores() {
  useTabStore.getState().removeWindow(WINDOW);
  Object.keys(useDocumentStore.getState().documents).forEach((id) =>
    useDocumentStore.getState().removeDocument(id)
  );
  useUIStore.setState({ statusBarVisible: true, universalToolbarVisible: false });
}

describe("useTabShortcuts — status bar toggle", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    matchTarget = null;
    isDocWindow = true;
    windowLbl = "main";
    imeResult = false;
  });

  it("toggles status bar off when currently visible and shortcut matches", async () => {
    useUIStore.setState({ statusBarVisible: true });
    matchTarget = "F7"; // match toggleStatusBar shortcut

    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });

    const event = new KeyboardEvent("keydown", {
      key: "F7",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(useUIStore.getState().statusBarVisible).toBe(false);
  });

  it("toggles status bar on and closes search/toolbar when currently hidden", async () => {
    useUIStore.setState({
      statusBarVisible: false,
      universalToolbarVisible: true,
    });
    useUIStore.getState().searchOpen();

    matchTarget = "F7";

    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });

    const event = new KeyboardEvent("keydown", {
      key: "F7",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(useUIStore.getState().statusBarVisible).toBe(true);
    expect(useUIStore.getState().universalToolbarVisible).toBe(false);
    expect(useUIStore.getState().search.isOpen).toBe(false);
  });

  it("does nothing when not a document window", async () => {
    isDocWindow = false;

    await act(async () => {
      render(<TestHarness />);
    });

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
  });

  it("ignores IME key events", async () => {
    imeResult = true;

    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
  });
});
