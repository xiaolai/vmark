// WI-S0.1 — the embedded browser's user-facing trigger: the newBrowserTab shortcut
//           dispatches `browser.newTab` through the CommandBus, so the
//           `browser.enabled` gate lives in exactly one place.
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// Mock closeTabWithDirtyCheck to track calls without side effects
const mockCloseTabWithDirtyCheck = vi.fn(
  (_windowLabel: string, _tabId: string) => Promise.resolve(true)
);
vi.mock("@/hooks/useTabOperations", () => ({
  closeTabWithDirtyCheck: (windowLabel: string, tabId: string) =>
    mockCloseTabWithDirtyCheck(windowLabel, tabId),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
  useIsDocumentWindow: () => true,
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: () => false,
}));

let matchesShortcutResult = false;
// When set, matchesShortcutEvent matches ONLY this key — lets a test target a
// single binding (e.g. newBrowserTab) without the blanket `() => true` firing
// an earlier handler (newTab). Null → legacy blanket behaviour.
let selectiveMatchKey: string | null = null;
vi.mock("@/utils/shortcutMatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/shortcutMatch")>();
  return {
    ...actual,
    matchesShortcutEvent: (_e: KeyboardEvent, key: string) =>
      selectiveMatchKey !== null ? key === selectiveMatchKey : matchesShortcutResult,
  };
});

const mockExecuteCommand = vi.fn((..._args: unknown[]) => Promise.resolve(true));
vi.mock("@/services/commands/CommandBus", () => ({
  executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
}));

// Import after mocks
import { useTabShortcuts } from "./useTabShortcuts";
import { useShortcutsStore } from "@/stores/settingsStore";

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
}

function fireKeydown(key: string, meta = true) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: meta,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe("useTabShortcuts — Cmd+W", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  it("closes the only tab via closeTabWithDirtyCheck", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });

    let event!: KeyboardEvent;
    act(() => {
      event = fireKeydown("w");
    });

    expect(mockCloseTabWithDirtyCheck).toHaveBeenCalledWith(WINDOW, tabId);
    expect(event.defaultPrevented).toBe(true);
  });

  it("closes the active tab when multiple tabs exist", async () => {
    useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    const tabId2 = useTabStore.getState().createTab(WINDOW, "/tmp/b.md");
    useDocumentStore.getState().initDocument(tabId2, "b", "/tmp/b.md");

    await act(async () => {
      render(<TestHarness />);
    });

    act(() => {
      fireKeydown("w");
    });

    // Should close the active (last created) tab
    expect(mockCloseTabWithDirtyCheck).toHaveBeenCalledWith(WINDOW, tabId2);
  });

  it("prevents default even when no active tab (blocks native window close)", async () => {
    // No tabs created — empty window
    await act(async () => {
      render(<TestHarness />);
    });

    let event!: KeyboardEvent;
    act(() => {
      event = fireKeydown("w");
    });

    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
    // preventDefault still called to block native Cmd+W window-close
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+W also triggers close (non-macOS)", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });

    const event = new KeyboardEvent("keydown", {
      key: "w",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockCloseTabWithDirtyCheck).toHaveBeenCalledWith(WINDOW, tabId);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not trigger close when key is not w", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });

    act(() => {
      fireKeydown("q"); // not w
    });

    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
  });

  it("does not close on W without modifier key", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    await act(async () => {
      render(<TestHarness />);
    });

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: false,
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockCloseTabWithDirtyCheck).not.toHaveBeenCalled();
  });
});

describe("useTabShortcuts — newTab shortcut", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    matchesShortcutResult = false;
  });

  it("creates a new tab when newTab shortcut matches", async () => {
    // Make matchesShortcutEvent return true for all checks (newTab will match first)
    matchesShortcutResult = true;

    await act(async () => {
      render(<TestHarness />);
    });

    const tabsBefore = useTabStore.getState().getTabsByWindow(WINDOW).length;

    act(() => {
      fireKeydown("t"); // any key, matchesShortcutEvent returns true
    });

    const tabsAfter = useTabStore.getState().getTabsByWindow(WINDOW).length;
    // newTab match should have created a tab
    expect(tabsAfter).toBe(tabsBefore + 1);

    matchesShortcutResult = false;
  });
});

describe("useTabShortcuts — newBrowserTab shortcut (WI-S0.1)", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    matchesShortcutResult = false;
    selectiveMatchKey = null;
  });

  it("dispatches the browser.newTab command when the newBrowserTab shortcut matches", async () => {
    // Match ONLY the newBrowserTab binding so the earlier newTab handler
    // (Mod-t) does not fire first.
    selectiveMatchKey = useShortcutsStore.getState().getShortcut("newBrowserTab");
    expect(selectiveMatchKey).toBeTruthy(); // the binding must exist

    await act(async () => {
      render(<TestHarness />);
    });

    let event!: KeyboardEvent;
    act(() => {
      event = new KeyboardEvent("keydown", {
        key: "b",
        metaKey: true,
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
    });

    // Routed through the CommandBus so the browser.enabled `when` gate applies
    // in exactly one place; ctx carries the window label the command needs.
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      "browser.newTab",
      null,
      { windowLabel: WINDOW },
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not dispatch browser.newTab for an unrelated shortcut", async () => {
    // Blanket-match everything EXCEPT — selective off, blanket off: nothing matches.
    selectiveMatchKey = "Mod-t"; // matches newTab, not newBrowserTab

    await act(async () => {
      render(<TestHarness />);
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "t", metaKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(mockExecuteCommand).not.toHaveBeenCalled();
    selectiveMatchKey = null;
  });
});

describe("useTabShortcuts — cleanup", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    matchesShortcutResult = false;
  });

  it("cleans up listener on unmount", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const tabId = useTabStore.getState().createTab(WINDOW, null);
    useDocumentStore.getState().initDocument(tabId, "", null);

    let unmountFn: () => void;
    await act(async () => {
      const { unmount } = render(<TestHarness />);
      unmountFn = unmount;
    });

    act(() => {
      unmountFn();
    });

    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });
});
