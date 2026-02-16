/**
 * FindBar IME composition guard tests
 *
 * Verifies that keyDown handlers don't trigger find/replace actions
 * during the grace period after compositionend (macOS WebKit edge case).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock imeGuard
vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

// Mock useImeComposition with controllable isComposing
const mockIsComposing = vi.fn(() => false);
vi.mock("@/hooks/useImeComposition", () => ({
  useImeComposition: () => ({
    composingRef: { current: false },
    onCompositionStart: vi.fn(),
    onCompositionEnd: vi.fn(),
    isComposing: mockIsComposing,
  }),
}));

// Mock searchStore
const mockFindNext = vi.fn();
const mockFindPrevious = vi.fn();
const mockReplaceCurrent = vi.fn();
const mockClose = vi.fn();

vi.mock("@/stores/searchStore", () => {
  const store = vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      isOpen: true,
      query: "test",
      replaceText: "",
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      matchCount: 1,
      currentIndex: 0,
    })
  );
  (store as unknown as Record<string, unknown>).getState = () => ({
    findNext: mockFindNext,
    findPrevious: mockFindPrevious,
    replaceCurrent: mockReplaceCurrent,
    close: mockClose,
    setQuery: vi.fn(),
    setReplaceText: vi.fn(),
  });
  return { useSearchStore: store };
});

vi.mock("@/stores/settingsStore", () => {
  const store = vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ markdown: { enableRegexSearch: false } })
  );
  return { useSettingsStore: store };
});

import { FindBar } from "./FindBar";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsComposing.mockReturnValue(false);
});

describe("IME composition guard", () => {
  it("Enter within grace period does not trigger findNext", () => {
    render(<FindBar />);
    const findInput = screen.getByPlaceholderText("Find...");

    mockIsComposing.mockReturnValue(true);
    fireEvent.keyDown(findInput, { key: "Enter" });

    expect(mockFindNext).not.toHaveBeenCalled();
  });

  it("Shift+Enter within grace period does not trigger findPrevious", () => {
    render(<FindBar />);
    const findInput = screen.getByPlaceholderText("Find...");

    mockIsComposing.mockReturnValue(true);
    fireEvent.keyDown(findInput, { key: "Enter", shiftKey: true });

    expect(mockFindPrevious).not.toHaveBeenCalled();
  });

  it("Escape within grace period does not close", () => {
    render(<FindBar />);
    const findInput = screen.getByPlaceholderText("Find...");

    mockIsComposing.mockReturnValue(true);
    fireEvent.keyDown(findInput, { key: "Escape" });

    expect(mockClose).not.toHaveBeenCalled();
  });

  it("Enter within grace period on replace input does not trigger replaceCurrent", () => {
    render(<FindBar />);
    const replaceInput = screen.getByPlaceholderText("Replace...");

    mockIsComposing.mockReturnValue(true);
    fireEvent.keyDown(replaceInput, { key: "Enter" });

    expect(mockReplaceCurrent).not.toHaveBeenCalled();
  });

  it("Enter works normally outside grace period", () => {
    render(<FindBar />);
    const findInput = screen.getByPlaceholderText("Find...");

    mockIsComposing.mockReturnValue(false);
    fireEvent.keyDown(findInput, { key: "Enter" });

    expect(mockFindNext).toHaveBeenCalled();
  });
});
