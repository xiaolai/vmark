import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TerminalSearchBar } from "./TerminalSearchBar";
import type { SearchAddon } from "@xterm/addon-search";

function makeMockAddon(): SearchAddon {
  return {
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearDecorations: vi.fn(),
    dispose: vi.fn(),
  } as unknown as SearchAddon;
}

describe("TerminalSearchBar", () => {
  let addon: SearchAddon;
  let getSearchAddon: () => SearchAddon | null;
  let onClose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    addon = makeMockAddon();
    getSearchAddon = () => addon;
    onClose = vi.fn<() => void>();
  });

  it("renders with search input", () => {
    render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  // WI-2.4 (a11y) — accessible name on the search input. Placeholder text
  // is not a reliable label for screen readers; aria-label is. This test
  // locks the t("terminal.search.label") → role-name mapping.
  it("exposes an accessible name on the search input (aria-label)", () => {
    render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
    expect(
      screen.getByRole("textbox", { name: /search terminal output/i }),
    ).toBeInTheDocument();
  });

  it("searches on input change", () => {
    render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "hello" } });
    expect(addon.findNext).toHaveBeenCalledWith("hello");
  });

  it("finds next on Enter, previous on Shift+Enter", () => {
    render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "test" } });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(addon.findNext).toHaveBeenCalledTimes(2); // once from change, once from Enter

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(addon.findPrevious).toHaveBeenCalledWith("test");
  });

  it("closes on Escape", () => {
    render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search...");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(addon.clearDecorations).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  describe("IME composition guard", () => {
    afterEach(() => {
      cleanup();
    });

    it("Enter with isComposing does not trigger findNext", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "test" } });
      vi.clearAllMocks();

      fireEvent.keyDown(input, { key: "Enter", isComposing: true });

      expect(addon.findNext).not.toHaveBeenCalled();
    });

    it("Escape with isComposing does not close", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");

      fireEvent.keyDown(input, { key: "Escape", isComposing: true });

      expect(onClose).not.toHaveBeenCalled();
    });

    it("keyCode 229 (IME marker) is blocked", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "test" } });
      vi.clearAllMocks();

      fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

      expect(addon.findNext).not.toHaveBeenCalled();
    });

    it("Enter within grace period after compositionEnd is blocked", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "test" } });

      // Simulate composition cycle (compositionEnd triggers search by design)
      fireEvent.compositionStart(input);
      fireEvent.compositionEnd(input);
      vi.clearAllMocks();

      // Immediate keyDown Enter — should be blocked by grace period
      fireEvent.keyDown(input, { key: "Enter" });

      expect(addon.findNext).not.toHaveBeenCalled();
    });

    it("does not double-search when onChange fires after compositionEnd", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");

      // Start composition
      fireEvent.compositionStart(input);

      // Type during composition
      fireEvent.change(input, { target: { value: "ni hao" } });

      // End composition — triggers findNext
      fireEvent.compositionEnd(input);
      vi.clearAllMocks();

      // Subsequent onChange with same committed value — should be deduped
      fireEvent.change(input, { target: { value: "ni hao" } });
      expect(addon.findNext).not.toHaveBeenCalled();
    });

    it("skips addon.findNext during composition onChange", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");

      // Start composition
      fireEvent.compositionStart(input);
      vi.clearAllMocks();

      // Type during composition — should NOT trigger findNext
      fireEvent.change(input, { target: { value: "ni" } });
      expect(addon.findNext).not.toHaveBeenCalled();

      // End composition — should trigger findNext with final value
      fireEvent.compositionEnd(input);
      // After compositionEnd, the component should search with current query
      expect(addon.findNext).toHaveBeenCalled();
    });
  });

  describe("button clicks", () => {
    it("previous button calls findPrevious", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "test" } });
      vi.clearAllMocks();

      const prevBtn = screen.getByTitle("Previous (Shift+Enter)");
      fireEvent.click(prevBtn);
      expect(addon.findPrevious).toHaveBeenCalledWith("test");
    });

    it("next button calls findNext", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "test" } });
      vi.clearAllMocks();

      const nextBtn = screen.getByTitle("Next (Enter)");
      fireEvent.click(nextBtn);
      expect(addon.findNext).toHaveBeenCalledWith("test");
    });

    it("close button clears decorations and calls onClose", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);

      const closeBtn = screen.getByTitle("Close (Escape)");
      fireEvent.click(closeBtn);
      expect(addon.clearDecorations).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("prev/next buttons are disabled when query is empty", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);

      const prevBtn = screen.getByTitle("Previous (Shift+Enter)");
      const nextBtn = screen.getByTitle("Next (Enter)");
      expect(prevBtn).toBeDisabled();
      expect(nextBtn).toBeDisabled();
    });

    it("prev/next buttons are enabled when query is non-empty", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "hello" } });

      const prevBtn = screen.getByTitle("Previous (Shift+Enter)");
      const nextBtn = screen.getByTitle("Next (Enter)");
      expect(prevBtn).not.toBeDisabled();
      expect(nextBtn).not.toBeDisabled();
    });
  });

  describe("edge cases", () => {
    it("clearing input clears decorations", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "test" } });
      vi.clearAllMocks();

      fireEvent.change(input, { target: { value: "" } });
      expect(addon.clearDecorations).toHaveBeenCalled();
      expect(addon.findNext).not.toHaveBeenCalled();
    });

    it("handles null search addon gracefully on input", () => {
      const nullAddonGetter = () => null;
      render(<TerminalSearchBar getSearchAddon={nullAddonGetter} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");

      // Should not throw
      expect(() => {
        fireEvent.change(input, { target: { value: "test" } });
      }).not.toThrow();
    });

    it("handles null search addon gracefully on Enter", () => {
      const nullAddonGetter = () => null;
      render(<TerminalSearchBar getSearchAddon={nullAddonGetter} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "test" } });

      expect(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      }).not.toThrow();
    });

    it("handles null search addon gracefully on close", () => {
      const nullAddonGetter = () => null;
      render(<TerminalSearchBar getSearchAddon={nullAddonGetter} onClose={onClose} />);

      expect(() => {
        fireEvent.keyDown(screen.getByPlaceholderText("Search..."), { key: "Escape" });
      }).not.toThrow();
      expect(onClose).toHaveBeenCalled();
    });

    it("compositionEnd with empty query clears decorations", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");

      fireEvent.compositionStart(input);
      // Simulate composition that results in empty (user cancelled)
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.compositionEnd(input);

      expect(addon.clearDecorations).toHaveBeenCalled();
    });

    it("auto-focuses the input on mount", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      expect(document.activeElement).toBe(input);
    });
  });
});
