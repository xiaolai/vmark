/**
 * Tests for useFileExplorerShortcuts hook
 *
 * Covers: shortcut dispatch, INPUT/TEXTAREA guard, IME guard,
 * non-workspace guard, and toggleHiddenFiles/toggleAllFiles calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// --- Mocks ---

const mockIsImeKeyEvent = vi.fn(() => false);
vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: (...args: unknown[]) => mockIsImeKeyEvent(...args),
}));

const mockToggleShowHiddenFiles = vi.fn();
const mockToggleShowAllFiles = vi.fn();
vi.mock("@/hooks/workspaceConfig", () => ({
  toggleShowHiddenFiles: (...args: unknown[]) => mockToggleShowHiddenFiles(...args),
  toggleShowAllFiles: (...args: unknown[]) => mockToggleShowAllFiles(...args),
}));

const mockMatchesShortcutEvent = vi.fn(() => false);
vi.mock("@/utils/shortcutMatch", () => ({
  matchesShortcutEvent: (...args: unknown[]) => mockMatchesShortcutEvent(...args),
}));

const mockWorkspaceGetState = vi.fn(() => ({
  isWorkspaceMode: true,
  config: { showHiddenFiles: false },
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: { getState: () => mockWorkspaceGetState() },
}));

const mockGetShortcut = vi.fn((id: string) => `mock-${id}`);
vi.mock("@/stores/settingsStore", () => ({
  useShortcutsStore: { getState: () => ({ getShortcut: mockGetShortcut }) },
}));

// --- Import after mocks ---

import { useFileExplorerShortcuts } from "./useFileExplorerShortcuts";

// --- Helpers ---

function fireKeyDown(opts: Partial<KeyboardEvent> = {}) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts });
  document.body.dispatchEvent(event);
  return event;
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceGetState.mockReturnValue({
    isWorkspaceMode: true,
    config: { showHiddenFiles: false },
  });
});

describe("useFileExplorerShortcuts", () => {
  afterEach(() => {
    // renderHook cleanup removes listeners
  });

  it("calls toggleShowHiddenFiles when hidden-files shortcut matches", () => {
    mockMatchesShortcutEvent.mockImplementation((_e, shortcut) => shortcut === "mock-toggleHiddenFiles");
    renderHook(() => useFileExplorerShortcuts());

    fireKeyDown({ key: "h" });

    expect(mockToggleShowHiddenFiles).toHaveBeenCalled();
    expect(mockToggleShowAllFiles).not.toHaveBeenCalled();
  });

  it("calls toggleShowAllFiles when all-files shortcut matches", () => {
    mockMatchesShortcutEvent.mockImplementation((_e, shortcut) => shortcut === "mock-toggleAllFiles");
    renderHook(() => useFileExplorerShortcuts());

    fireKeyDown({ key: "a" });

    expect(mockToggleShowAllFiles).toHaveBeenCalled();
    expect(mockToggleShowHiddenFiles).not.toHaveBeenCalled();
  });

  it("skips when IME event detected", () => {
    mockIsImeKeyEvent.mockReturnValue(true);
    mockMatchesShortcutEvent.mockReturnValue(true);
    renderHook(() => useFileExplorerShortcuts());

    fireKeyDown({ key: "h" });

    expect(mockToggleShowHiddenFiles).not.toHaveBeenCalled();
  });

  it("skips when not in workspace mode", () => {
    mockWorkspaceGetState.mockReturnValue({ isWorkspaceMode: false, config: null });
    mockMatchesShortcutEvent.mockReturnValue(true);
    renderHook(() => useFileExplorerShortcuts());

    fireKeyDown({ key: "h" });

    expect(mockToggleShowHiddenFiles).not.toHaveBeenCalled();
  });

  it("skips when focus is in INPUT element", () => {
    mockMatchesShortcutEvent.mockReturnValue(true);
    renderHook(() => useFileExplorerShortcuts());

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent("keydown", { bubbles: true, key: "h" });
    input.dispatchEvent(event);

    expect(mockToggleShowHiddenFiles).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("skips when target is an INPUT element (via target override)", () => {
    mockMatchesShortcutEvent.mockReturnValue(true);
    renderHook(() => useFileExplorerShortcuts());

    const input = document.createElement("input");
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "h" });
    Object.defineProperty(event, "target", { value: input });
    window.dispatchEvent(event);

    expect(mockToggleShowHiddenFiles).not.toHaveBeenCalled();
  });

  it("skips when focus is in TEXTAREA element", () => {
    mockMatchesShortcutEvent.mockReturnValue(true);
    renderHook(() => useFileExplorerShortcuts());

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    const event = new KeyboardEvent("keydown", { bubbles: true, key: "h" });
    textarea.dispatchEvent(event);

    expect(mockToggleShowHiddenFiles).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it("does nothing when no shortcut matches", () => {
    mockMatchesShortcutEvent.mockReturnValue(false);
    renderHook(() => useFileExplorerShortcuts());

    fireKeyDown({ key: "x" });

    expect(mockToggleShowHiddenFiles).not.toHaveBeenCalled();
    expect(mockToggleShowAllFiles).not.toHaveBeenCalled();
  });
});
