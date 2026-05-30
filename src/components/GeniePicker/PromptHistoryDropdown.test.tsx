/**
 * PromptHistoryDropdown — Tests
 *
 * Covers:
 * - Empty state ("No history")
 * - Rendering entries with first-line extraction
 * - Selected index styling
 * - Click on entry calls onSelect with index
 * - Scroll into view on selectedIndex change
 * - Outside click closes dropdown
 * - Header content and Ctrl+R hint
 * - Edge cases: multiline entries, single entry, large list
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptHistoryDropdown } from "./PromptHistoryDropdown";

// jsdom does not implement scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ============================================================================
// Tests
// ============================================================================

describe("PromptHistoryDropdown", () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------

  describe("empty state", () => {
    it("renders 'No history' when entries is empty", () => {
      render(
        <PromptHistoryDropdown
          entries={[]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      expect(screen.getByText("No history")).toBeInTheDocument();
    });

    it("does not render header when entries is empty", () => {
      render(
        <PromptHistoryDropdown
          entries={[]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      expect(screen.queryByText("Prompt History")).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Rendering entries
  // --------------------------------------------------------------------------

  describe("rendering entries", () => {
    it("renders header with title and Ctrl+R hint", () => {
      render(
        <PromptHistoryDropdown
          entries={["hello"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      expect(screen.getByText("Prompt History")).toBeInTheDocument();
      expect(screen.getByText("Ctrl+R")).toBeInTheDocument();
    });

    it("renders each entry showing only the first line", () => {
      const entries = [
        "First prompt\nwith second line",
        "Second prompt\nwith more content\nand third line",
        "Third prompt",
      ];
      render(
        <PromptHistoryDropdown
          entries={entries}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      expect(screen.getByText("First prompt")).toBeInTheDocument();
      expect(screen.getByText("Second prompt")).toBeInTheDocument();
      expect(screen.getByText("Third prompt")).toBeInTheDocument();
      // Second lines should not be rendered
      expect(screen.queryByText("with second line")).toBeNull();
      expect(screen.queryByText("with more content")).toBeNull();
    });

    it("renders single-line entries as-is", () => {
      render(
        <PromptHistoryDropdown
          entries={["Simple prompt"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      expect(screen.getByText("Simple prompt")).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Selected index styling
  // --------------------------------------------------------------------------

  describe("selected index", () => {
    it("applies selected class to the item at selectedIndex", () => {
      const { container } = render(
        <PromptHistoryDropdown
          entries={["First", "Second", "Third"]}
          selectedIndex={1}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      const items = container.querySelectorAll(".prompt-history-dropdown-item");
      expect(items[0]?.classList.contains("prompt-history-dropdown-item--selected")).toBe(false);
      expect(items[1]?.classList.contains("prompt-history-dropdown-item--selected")).toBe(true);
      expect(items[2]?.classList.contains("prompt-history-dropdown-item--selected")).toBe(false);
    });

    it("sets data-dropdown-index on each item", () => {
      const { container } = render(
        <PromptHistoryDropdown
          entries={["A", "B", "C"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      const items = container.querySelectorAll(".prompt-history-dropdown-item");
      expect(items[0]?.getAttribute("data-dropdown-index")).toBe("0");
      expect(items[1]?.getAttribute("data-dropdown-index")).toBe("1");
      expect(items[2]?.getAttribute("data-dropdown-index")).toBe("2");
    });
  });

  // --------------------------------------------------------------------------
  // Click handling
  // --------------------------------------------------------------------------

  describe("click handling", () => {
    it("calls onSelect with the entry index on click", async () => {
      const user = userEvent.setup();
      render(
        <PromptHistoryDropdown
          entries={["First", "Second", "Third"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      await user.click(screen.getByText("Second"));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it("calls onSelect with 0 when clicking first entry", async () => {
      const user = userEvent.setup();
      render(
        <PromptHistoryDropdown
          entries={["Only entry"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      await user.click(screen.getByText("Only entry"));

      expect(onSelect).toHaveBeenCalledWith(0);
    });
  });

  // --------------------------------------------------------------------------
  // Outside click closes dropdown
  // --------------------------------------------------------------------------

  describe("outside click", () => {
    it("calls onClose when clicking outside the dropdown", () => {
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <PromptHistoryDropdown
            entries={["Entry"]}
            selectedIndex={0}
            onSelect={onSelect}
            onClose={onClose}
          />
        </div>
      );

      fireEvent.mouseDown(screen.getByTestId("outside"));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not call onClose when clicking inside the dropdown", () => {
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <PromptHistoryDropdown
            entries={["Entry"]}
            selectedIndex={0}
            onSelect={onSelect}
            onClose={onClose}
          />
        </div>
      );

      fireEvent.mouseDown(screen.getByText("Entry"));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Scroll into view
  // --------------------------------------------------------------------------

  describe("scroll into view", () => {
    it("calls scrollIntoView on the selected item", () => {
      const scrollIntoViewMock = vi.fn();
      // We need to mock scrollIntoView on elements
      Element.prototype.scrollIntoView = scrollIntoViewMock;

      const { rerender } = render(
        <PromptHistoryDropdown
          entries={["A", "B", "C"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      scrollIntoViewMock.mockClear();

      rerender(
        <PromptHistoryDropdown
          entries={["A", "B", "C"]}
          selectedIndex={2}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles entry that is just a newline", () => {
      render(
        <PromptHistoryDropdown
          entries={["\nsecond line only"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      // First line is empty string, but component should still render
      const item = document.querySelector(".prompt-history-dropdown-item");
      expect(item).not.toBeNull();
    });

    it("handles large number of entries", () => {
      const entries = Array.from({ length: 100 }, (_, i) => `Prompt ${i}`);
      const { container } = render(
        <PromptHistoryDropdown
          entries={entries}
          selectedIndex={50}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      const items = container.querySelectorAll(".prompt-history-dropdown-item");
      expect(items).toHaveLength(100);
    });

    it("handles entry with only whitespace on first line", () => {
      render(
        <PromptHistoryDropdown
          entries={["   \nactual content"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      // Should render the whitespace first line
      const item = document.querySelector(".prompt-history-dropdown-text");
      expect(item).not.toBeNull();
    });

    it("cleans up mousedown listener on unmount", () => {
      const removeSpy = vi.spyOn(document, "removeEventListener");

      const { unmount } = render(
        <PromptHistoryDropdown
          entries={["Entry"]}
          selectedIndex={0}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      unmount();

      const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
      expect(removedTypes).toContain("mousedown");

      removeSpy.mockRestore();
    });

    // A4 — list is a listbox; rows are options with aria-selected on the
    // active row so screen readers announce selection.
    it("exposes listbox/option roles with aria-selected on the active row", () => {
      render(
        <PromptHistoryDropdown
          entries={["First", "Second", "Third"]}
          selectedIndex={1}
          onSelect={onSelect}
          onClose={onClose}
        />
      );
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(3);
      expect(options[1]).toHaveAttribute("aria-selected", "true");
      expect(options[0]).toHaveAttribute("aria-selected", "false");
    });
  });
});
