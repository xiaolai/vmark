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

vi.mock("@/utils/shortcutMatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/shortcutMatch")>();
  return {
    ...actual,
    matchesShortcutEvent: () => false,
  };
});

// Import after mocks
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
});
