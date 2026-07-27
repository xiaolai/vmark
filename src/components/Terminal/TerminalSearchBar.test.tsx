import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { TerminalSearchBar } from "./TerminalSearchBar";
import type { SearchAddon } from "@xterm/addon-search";

/** The options object every find call carries when no toggle is on. */
const ALL_OFF = { caseSensitive: false, wholeWord: false, regex: false };

/** Captured `onDidChangeResults` listener + its disposal spy, per addon. */
interface ResultsHook {
  emit: (state: { resultIndex: number; resultCount: number }) => void;
  dispose: ReturnType<typeof vi.fn>;
  subscribed: () => number;
}

let resultsHook: ResultsHook;

function makeMockAddon(): SearchAddon {
  let listener: ((s: { resultIndex: number; resultCount: number }) => void) | null = null;
  const dispose = vi.fn();
  let subscriptions = 0;
  resultsHook = {
    // Wrapped in act(): the addon fires this outside React's event system,
    // so without it the setResult update would not flush before assertions.
    emit: (state) => act(() => listener?.(state)),
    dispose,
    subscribed: () => subscriptions,
  };
  return {
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearDecorations: vi.fn(),
    dispose: vi.fn(),
    onDidChangeResults: vi.fn((cb: (s: { resultIndex: number; resultCount: number }) => void) => {
      listener = cb;
      subscriptions++;
      return { dispose };
    }),
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
    expect(addon.findNext).toHaveBeenCalledWith("hello", ALL_OFF);
  });

  it("finds next on Enter, previous on Shift+Enter", () => {
    render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "test" } });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(addon.findNext).toHaveBeenCalledTimes(2); // once from change, once from Enter

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(addon.findPrevious).toHaveBeenCalledWith("test", ALL_OFF);
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
      expect(addon.findPrevious).toHaveBeenCalledWith("test", ALL_OFF);
    });

    it("next button calls findNext", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const input = screen.getByPlaceholderText("Search...");
      fireEvent.change(input, { target: { value: "test" } });
      vi.clearAllMocks();

      const nextBtn = screen.getByTitle("Next (Enter)");
      fireEvent.click(nextBtn);
      expect(addon.findNext).toHaveBeenCalledWith("test", ALL_OFF);
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

  describe("result count (WI-3.1)", () => {
    afterEach(cleanup);

    /** The element that reports how many matches there are. */
    function results(): HTMLElement | null {
      return document.querySelector(".terminal-search-results");
    }

    function type(value: string) {
      fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value } });
    }

    it("shows nothing before a query is typed", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      resultsHook.emit({ resultIndex: 0, resultCount: 5 });
      expect(results()?.textContent ?? "").toBe("");
    });

    it("renders a 1-based position within the count", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("e");
      resultsHook.emit({ resultIndex: 2, resultCount: 17 });
      expect(results()?.textContent).toBe("3 / 17");
    });

    it("renders the no-match state for a non-empty query with zero results", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("zzz");
      resultsHook.emit({ resultIndex: -1, resultCount: 0 });
      expect(results()?.textContent).toBe("No results");
      expect(screen.getByPlaceholderText("Search...")).toHaveClass(
        "terminal-search-input--no-match",
      );
    });

    it("renders a count WITHOUT a position when the threshold is exceeded", () => {
      // resultIndex === -1 with a non-zero count: the addon has too many
      // matches to track the active one. "0 / N" would be a lie.
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("e");
      resultsHook.emit({ resultIndex: -1, resultCount: 5000 });
      expect(results()?.textContent).toBe("5000 matches");
      expect(results()?.textContent).not.toContain("/");
      expect(screen.getByPlaceholderText("Search...")).not.toHaveClass(
        "terminal-search-input--no-match",
      );
    });

    it("clears both states when the query is emptied", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("zzz");
      resultsHook.emit({ resultIndex: -1, resultCount: 0 });
      expect(results()?.textContent).toBe("No results");

      type("");
      expect(results()?.textContent ?? "").toBe("");
      expect(screen.getByPlaceholderText("Search...")).not.toHaveClass(
        "terminal-search-input--no-match",
      );
    });

    it("exposes the result summary to assistive tech as a live region", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("e");
      resultsHook.emit({ resultIndex: 0, resultCount: 3 });
      expect(results()).toHaveAttribute("aria-live", "polite");
    });

    it("disposes the result listener on unmount", () => {
      const { unmount } = render(
        <TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />,
      );
      expect(resultsHook.subscribed()).toBe(1);
      expect(resultsHook.dispose).not.toHaveBeenCalled();
      unmount();
      expect(resultsHook.dispose).toHaveBeenCalledTimes(1);
    });

    it("subscribes exactly once across re-renders from typing", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("a");
      type("ab");
      type("abc");
      expect(resultsHook.subscribed()).toBe(1);
    });

    it("does not throw when the addon predates onDidChangeResults", () => {
      const legacy = {
        findNext: vi.fn(),
        findPrevious: vi.fn(),
        clearDecorations: vi.fn(),
      } as unknown as SearchAddon;
      expect(() =>
        render(<TerminalSearchBar getSearchAddon={() => legacy} onClose={onClose} />),
      ).not.toThrow();
    });

    it("clears decorations on unmount even for a legacy addon", () => {
      // A legacy addon still PAINTS decorations, so bailing out before
      // registering cleanup left them on screen after Cmd+F closed the bar.
      const clearDecorations = vi.fn();
      const legacy = {
        findNext: vi.fn(),
        findPrevious: vi.fn(),
        clearDecorations,
      } as unknown as SearchAddon;
      const { unmount } = render(
        <TerminalSearchBar getSearchAddon={() => legacy} onClose={onClose} />,
      );
      clearDecorations.mockClear();
      unmount();
      expect(clearDecorations).toHaveBeenCalled();
    });

    it("clears decorations on unmount for a modern addon too", () => {
      // Cmd+F unmounts the bar without going through handleClose.
      const { unmount } = render(
        <TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />,
      );
      vi.mocked(addon.clearDecorations).mockClear();
      unmount();
      expect(addon.clearDecorations).toHaveBeenCalled();
    });
  });

  describe("search option toggles (WI-3.2)", () => {
    afterEach(cleanup);

    function toggle(name: RegExp) {
      return screen.getByRole("button", { name });
    }

    function type(value: string) {
      fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value } });
    }

    it.each([
      [/match case/i, "caseSensitive"],
      [/whole word/i, "wholeWord"],
      [/regular expression/i, "regex"],
    ])("%s reaches findNext in the options object", (name, field) => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("abc");
      vi.clearAllMocks();

      fireEvent.click(toggle(name));

      expect(addon.findNext).toHaveBeenLastCalledWith("abc", {
        ...ALL_OFF,
        [field]: true,
      });
    });

    it("carries the toggles into findPrevious too", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("abc");
      fireEvent.click(toggle(/match case/i));
      vi.clearAllMocks();

      fireEvent.click(screen.getByTitle("Previous (Shift+Enter)"));

      expect(addon.findPrevious).toHaveBeenCalledWith("abc", {
        ...ALL_OFF,
        caseSensitive: true,
      });
    });

    it("carries the toggles into an Enter-driven search", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("abc");
      fireEvent.click(toggle(/whole word/i));
      vi.clearAllMocks();

      fireEvent.keyDown(screen.getByPlaceholderText("Search..."), { key: "Enter" });

      expect(addon.findNext).toHaveBeenCalledWith("abc", {
        ...ALL_OFF,
        wholeWord: true,
      });
    });

    it("reports state via aria-pressed", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      const btn = toggle(/match case/i);
      expect(btn).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(btn);
      expect(btn).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(btn);
      expect(btn).toHaveAttribute("aria-pressed", "false");
    });

    it("combines toggles rather than replacing each other", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("abc");
      fireEvent.click(toggle(/match case/i));
      fireEvent.click(toggle(/whole word/i));
      vi.clearAllMocks();
      fireEvent.keyDown(screen.getByPlaceholderText("Search..."), { key: "Enter" });

      expect(addon.findNext).toHaveBeenCalledWith("abc", {
        caseSensitive: true,
        wholeWord: true,
        regex: false,
      });
    });

    it("does not throw on an invalid regex, and shows the no-match state", () => {
      // "[" is a legal keystroke on the way to "[a-z]"; handing it to the
      // addon throws.
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      fireEvent.click(toggle(/regular expression/i));
      vi.clearAllMocks();

      expect(() => type("[")).not.toThrow();

      expect(addon.findNext).not.toHaveBeenCalled();
      expect(document.querySelector(".terminal-search-results")?.textContent).toBe(
        "No results",
      );
      expect(screen.getByPlaceholderText("Search...")).toHaveClass(
        "terminal-search-input--no-match",
      );
    });

    it("resumes searching once the regex becomes valid", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      fireEvent.click(toggle(/regular expression/i));
      type("[");
      vi.clearAllMocks();

      type("[a-z]");

      expect(addon.findNext).toHaveBeenCalledWith("[a-z]", {
        ...ALL_OFF,
        regex: true,
      });
    });

    it("does not search an invalid regex when regex is toggled ON after typing", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      type("(");
      vi.clearAllMocks();

      fireEvent.click(toggle(/regular expression/i));

      expect(addon.findNext).not.toHaveBeenCalled();
      expect(addon.clearDecorations).toHaveBeenCalled();
    });

    it("resets the toggles when the bar is closed and reopened (Q5)", () => {
      const first = render(
        <TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />,
      );
      fireEvent.click(toggle(/match case/i));
      expect(toggle(/match case/i)).toHaveAttribute("aria-pressed", "true");
      first.unmount();

      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      expect(toggle(/match case/i)).toHaveAttribute("aria-pressed", "false");
    });

    it("keeps every toggle keyboard-reachable as a real button", () => {
      render(<TerminalSearchBar getSearchAddon={getSearchAddon} onClose={onClose} />);
      for (const name of [/match case/i, /whole word/i, /regular expression/i]) {
        const btn = toggle(name);
        expect(btn.tagName).toBe("BUTTON");
        expect(btn).not.toBeDisabled();
      }
    });
  });
});
