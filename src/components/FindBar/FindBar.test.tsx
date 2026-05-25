/**
 * FindBar tests
 *
 * Tests rendering, search input, replace, match navigation, toggle buttons,
 * keyboard shortcuts (Escape to close, Enter to next/prev match, Tab to move focus),
 * match display, and IME composition guards.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Mock searchStore with controllable state
const mockFindNext = vi.fn();
const mockFindPrevious = vi.fn();
const mockReplaceCurrent = vi.fn();
const mockReplaceAll = vi.fn();
const mockClose = vi.fn();
const mockSetQuery = vi.fn();
const mockSetReplaceText = vi.fn();
const mockToggleCaseSensitive = vi.fn();
const mockToggleWholeWord = vi.fn();
const mockToggleRegex = vi.fn();

let mockSearchState: Record<string, unknown> = {
  isOpen: true,
  query: "",
  replaceText: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  matchCount: 0,
  currentIndex: -1,
};

vi.mock("@/stores/uiStore", () => {
  const store = vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ search: mockSearchState })
  );
  (store as unknown as Record<string, unknown>).getState = () => ({
    search: mockSearchState,
    searchFindNext: mockFindNext,
    searchFindPrevious: mockFindPrevious,
    searchReplaceCurrent: mockReplaceCurrent,
    searchReplaceAll: mockReplaceAll,
    searchClose: mockClose,
    searchSetQuery: mockSetQuery,
    searchSetReplaceText: mockSetReplaceText,
    searchToggleCaseSensitive: mockToggleCaseSensitive,
    searchToggleWholeWord: mockToggleWholeWord,
    searchToggleRegex: mockToggleRegex,
  });
  return { useUIStore: store };
});

let mockEnableRegex = true;
vi.mock("@/stores/settingsStore", () => {
  const store = vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ markdown: { enableRegexSearch: mockEnableRegex } })
  );
  return { useSettingsStore: store };
});

import { FindBar } from "./FindBar";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsComposing.mockReturnValue(false);
  mockEnableRegex = true;
  mockSearchState = {
    isOpen: true,
    query: "",
    replaceText: "",
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    matchCount: 0,
    currentIndex: -1,
  };
});

describe("FindBar", () => {
  describe("rendering", () => {
    it("renders nothing when isOpen is false", () => {
      mockSearchState.isOpen = false;
      const { container } = render(<FindBar />);
      expect(container.firstChild).toBeNull();
    });

    it("renders find and replace inputs when open", () => {
      render(<FindBar />);
      expect(screen.getByPlaceholderText("Find...")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Replace...")).toBeInTheDocument();
    });

    // WI-2.4 (a11y) — search input fields must have accessible names.
    // Placeholder alone is not a reliable label for screen readers.
    it("exposes accessible names on find and replace inputs", () => {
      render(<FindBar />);
      expect(
        screen.getByRole("textbox", { name: /search text in document/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("textbox", { name: /replacement text/i }),
      ).toBeInTheDocument();
    });

    it("renders close button", () => {
      render(<FindBar />);
      expect(screen.getByTitle("Close (Esc)")).toBeInTheDocument();
    });

    it("renders navigation buttons", () => {
      render(<FindBar />);
      expect(screen.getByTitle("Previous (Shift+Enter)")).toBeInTheDocument();
      expect(screen.getByTitle("Next (Enter)")).toBeInTheDocument();
    });

    it("renders replace action buttons", () => {
      render(<FindBar />);
      expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Replace All" })).toBeInTheDocument();
    });

    it("renders toggle buttons (case, whole word)", () => {
      render(<FindBar />);
      expect(screen.getByTitle("Match Case")).toBeInTheDocument();
      expect(screen.getByTitle("Whole Word")).toBeInTheDocument();
    });

    it("renders regex toggle when enableRegexSearch is true", () => {
      mockEnableRegex = true;
      render(<FindBar />);
      expect(screen.getByTitle("Use Regular Expression")).toBeInTheDocument();
    });

    it("hides regex toggle when enableRegexSearch is false", () => {
      mockEnableRegex = false;
      render(<FindBar />);
      expect(screen.queryByTitle("Use Regular Expression")).not.toBeInTheDocument();
    });
  });

  describe("match display", () => {
    it("shows empty string when no query", () => {
      mockSearchState.query = "";
      mockSearchState.matchCount = 0;
      render(<FindBar />);
      expect(screen.getByText("", { selector: ".find-bar-count" })).toBeInTheDocument();
    });

    it("shows 'No results' when query has no matches", () => {
      mockSearchState.query = "xyz";
      mockSearchState.matchCount = 0;
      render(<FindBar />);
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("shows 'N of M' when matches exist", () => {
      mockSearchState.query = "test";
      mockSearchState.matchCount = 5;
      mockSearchState.currentIndex = 2;
      render(<FindBar />);
      expect(screen.getByText("3 of 5")).toBeInTheDocument();
    });

    it("shows '1 of 1' for a single match", () => {
      mockSearchState.query = "test";
      mockSearchState.matchCount = 1;
      mockSearchState.currentIndex = 0;
      render(<FindBar />);
      expect(screen.getByText("1 of 1")).toBeInTheDocument();
    });
  });

  describe("navigation buttons disabled state", () => {
    it("disables prev/next when matchCount is 0", () => {
      mockSearchState.matchCount = 0;
      render(<FindBar />);
      expect(screen.getByTitle("Previous (Shift+Enter)")).toBeDisabled();
      expect(screen.getByTitle("Next (Enter)")).toBeDisabled();
    });

    it("enables prev/next when matches exist", () => {
      mockSearchState.matchCount = 3;
      mockSearchState.currentIndex = 0;
      render(<FindBar />);
      expect(screen.getByTitle("Previous (Shift+Enter)")).not.toBeDisabled();
      expect(screen.getByTitle("Next (Enter)")).not.toBeDisabled();
    });

    it("disables replace buttons when matchCount is 0", () => {
      mockSearchState.matchCount = 0;
      render(<FindBar />);
      expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Replace All" })).toBeDisabled();
    });

    it("enables replace buttons when matches exist", () => {
      mockSearchState.matchCount = 2;
      mockSearchState.currentIndex = 0;
      render(<FindBar />);
      expect(screen.getByRole("button", { name: "Replace" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Replace All" })).not.toBeDisabled();
    });
  });

  describe("search input interaction", () => {
    it("calls setQuery on input change", () => {
      render(<FindBar />);
      const input = screen.getByPlaceholderText("Find...");
      fireEvent.change(input, { target: { value: "hello" } });
      expect(mockSetQuery).toHaveBeenCalledWith("hello");
    });

    it("calls setReplaceText on replace input change", () => {
      render(<FindBar />);
      const input = screen.getByPlaceholderText("Replace...");
      fireEvent.change(input, { target: { value: "world" } });
      expect(mockSetReplaceText).toHaveBeenCalledWith("world");
    });
  });

  describe("keyboard shortcuts - find input", () => {
    it("Enter triggers findNext", () => {
      render(<FindBar />);
      const findInput = screen.getByPlaceholderText("Find...");
      fireEvent.keyDown(findInput, { key: "Enter" });
      expect(mockFindNext).toHaveBeenCalled();
    });

    it("Shift+Enter triggers findPrevious", () => {
      render(<FindBar />);
      const findInput = screen.getByPlaceholderText("Find...");
      fireEvent.keyDown(findInput, { key: "Enter", shiftKey: true });
      expect(mockFindPrevious).toHaveBeenCalled();
    });

    it("Escape triggers close", () => {
      render(<FindBar />);
      const findInput = screen.getByPlaceholderText("Find...");
      fireEvent.keyDown(findInput, { key: "Escape" });
      expect(mockClose).toHaveBeenCalled();
    });

    it("Tab moves focus to replace input", () => {
      render(<FindBar />);
      const findInput = screen.getByPlaceholderText("Find...");
      const replaceInput = screen.getByPlaceholderText("Replace...");
      findInput.focus();
      fireEvent.keyDown(findInput, { key: "Tab" });
      // The handler calls replaceInputRef.current?.focus()
      // In jsdom, we verify the preventDefault was called (Tab default behavior prevented)
      expect(document.activeElement).toBe(replaceInput);
    });
  });

  describe("keyboard shortcuts - replace input", () => {
    it("Enter triggers replaceCurrent", () => {
      render(<FindBar />);
      const replaceInput = screen.getByPlaceholderText("Replace...");
      fireEvent.keyDown(replaceInput, { key: "Enter" });
      expect(mockReplaceCurrent).toHaveBeenCalled();
    });

    it("Escape triggers close", () => {
      render(<FindBar />);
      const replaceInput = screen.getByPlaceholderText("Replace...");
      fireEvent.keyDown(replaceInput, { key: "Escape" });
      expect(mockClose).toHaveBeenCalled();
    });

    it("Shift+Tab moves focus to find input", () => {
      render(<FindBar />);
      const findInput = screen.getByPlaceholderText("Find...");
      const replaceInput = screen.getByPlaceholderText("Replace...");
      replaceInput.focus();
      fireEvent.keyDown(replaceInput, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(findInput);
    });
  });

  describe("button click actions", () => {
    it("close button triggers close", async () => {
      const user = userEvent.setup();
      render(<FindBar />);
      await user.click(screen.getByTitle("Close (Esc)"));
      expect(mockClose).toHaveBeenCalled();
    });

    it("next button triggers findNext", async () => {
      const user = userEvent.setup();
      mockSearchState.matchCount = 3;
      mockSearchState.currentIndex = 0;
      render(<FindBar />);
      await user.click(screen.getByTitle("Next (Enter)"));
      expect(mockFindNext).toHaveBeenCalled();
    });

    it("previous button triggers findPrevious", async () => {
      const user = userEvent.setup();
      mockSearchState.matchCount = 3;
      mockSearchState.currentIndex = 1;
      render(<FindBar />);
      await user.click(screen.getByTitle("Previous (Shift+Enter)"));
      expect(mockFindPrevious).toHaveBeenCalled();
    });

    it("replace button triggers replaceCurrent", async () => {
      const user = userEvent.setup();
      mockSearchState.matchCount = 2;
      mockSearchState.currentIndex = 0;
      render(<FindBar />);
      await user.click(screen.getByRole("button", { name: "Replace" }));
      expect(mockReplaceCurrent).toHaveBeenCalled();
    });

    it("replace all button triggers replaceAll", async () => {
      const user = userEvent.setup();
      mockSearchState.matchCount = 2;
      mockSearchState.currentIndex = 0;
      render(<FindBar />);
      await user.click(screen.getByRole("button", { name: "Replace All" }));
      expect(mockReplaceAll).toHaveBeenCalled();
    });
  });

  describe("toggle buttons", () => {
    it("case sensitive toggle calls toggleCaseSensitive", async () => {
      const user = userEvent.setup();
      render(<FindBar />);
      await user.click(screen.getByTitle("Match Case"));
      expect(mockToggleCaseSensitive).toHaveBeenCalled();
    });

    it("whole word toggle calls toggleWholeWord", async () => {
      const user = userEvent.setup();
      render(<FindBar />);
      await user.click(screen.getByTitle("Whole Word"));
      expect(mockToggleWholeWord).toHaveBeenCalled();
    });

    it("regex toggle calls toggleRegex", async () => {
      const user = userEvent.setup();
      mockEnableRegex = true;
      render(<FindBar />);
      await user.click(screen.getByTitle("Use Regular Expression"));
      expect(mockToggleRegex).toHaveBeenCalled();
    });

    it("case sensitive toggle has active class when enabled", () => {
      mockSearchState.caseSensitive = true;
      render(<FindBar />);
      const btn = screen.getByTitle("Match Case");
      expect(btn.className).toContain("active");
    });

    it("whole word toggle has active class when enabled", () => {
      mockSearchState.wholeWord = true;
      render(<FindBar />);
      const btn = screen.getByTitle("Whole Word");
      expect(btn.className).toContain("active");
    });

    it("regex toggle has active class when enabled", () => {
      mockSearchState.useRegex = true;
      mockEnableRegex = true;
      render(<FindBar />);
      const btn = screen.getByTitle("Use Regular Expression");
      expect(btn.className).toContain("active");
    });
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

  describe("preventSelectAllOnButtons", () => {
    it("prevents Cmd+A on non-input elements within the bar", () => {
      render(<FindBar />);
      const closeBtn = screen.getByTitle("Close (Esc)");
      closeBtn.focus();
      const event = new KeyboardEvent("keydown", {
        key: "a",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      const prevented = !closeBtn.dispatchEvent(event);
      // The onKeyDown handler on .find-bar checks target.tagName
      // Buttons should have default prevented
      expect(prevented || event.defaultPrevented).toBe(true);
    });
  });

  describe("input values reflect store state", () => {
    it("find input shows current query", () => {
      mockSearchState.query = "hello";
      render(<FindBar />);
      expect(screen.getByPlaceholderText("Find...")).toHaveValue("hello");
    });

    it("replace input shows current replaceText", () => {
      mockSearchState.replaceText = "world";
      render(<FindBar />);
      expect(screen.getByPlaceholderText("Replace...")).toHaveValue("world");
    });
  });
});
