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
});
