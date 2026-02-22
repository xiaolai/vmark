/**
 * Tests for searchStore — Find & Replace state management
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSearchStore } from "../searchStore";

beforeEach(() => {
  useSearchStore.setState(useSearchStore.getInitialState());
});

describe("searchStore", () => {
  describe("open / close / toggle", () => {
    it("opens the search bar", () => {
      useSearchStore.getState().open();
      expect(useSearchStore.getState().isOpen).toBe(true);
    });

    it("closes the search bar", () => {
      useSearchStore.setState({ isOpen: true });
      useSearchStore.getState().close();
      expect(useSearchStore.getState().isOpen).toBe(false);
    });

    it("toggles the search bar open", () => {
      useSearchStore.getState().toggle();
      expect(useSearchStore.getState().isOpen).toBe(true);
    });

    it("toggles the search bar closed", () => {
      useSearchStore.setState({ isOpen: true });
      useSearchStore.getState().toggle();
      expect(useSearchStore.getState().isOpen).toBe(false);
    });
  });

  describe("setQuery", () => {
    it("updates the query", () => {
      useSearchStore.getState().setQuery("hello");
      expect(useSearchStore.getState().query).toBe("hello");
    });

    it("resets currentIndex to -1 on query change", () => {
      useSearchStore.setState({ currentIndex: 3, matchCount: 5 });
      useSearchStore.getState().setQuery("new query");
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("accepts empty string", () => {
      useSearchStore.getState().setQuery("something");
      useSearchStore.getState().setQuery("");
      expect(useSearchStore.getState().query).toBe("");
    });
  });

  describe("setReplaceText", () => {
    it("updates the replace text", () => {
      useSearchStore.getState().setReplaceText("world");
      expect(useSearchStore.getState().replaceText).toBe("world");
    });

    it("accepts empty string", () => {
      useSearchStore.getState().setReplaceText("something");
      useSearchStore.getState().setReplaceText("");
      expect(useSearchStore.getState().replaceText).toBe("");
    });
  });

  describe("option toggles", () => {
    it("toggles caseSensitive on", () => {
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().caseSensitive).toBe(true);
    });

    it("toggles caseSensitive off", () => {
      useSearchStore.setState({ caseSensitive: true });
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().caseSensitive).toBe(false);
    });

    it("resets currentIndex when toggling caseSensitive", () => {
      useSearchStore.setState({ currentIndex: 2, matchCount: 5 });
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("toggles wholeWord on", () => {
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().wholeWord).toBe(true);
    });

    it("toggles wholeWord off", () => {
      useSearchStore.setState({ wholeWord: true });
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().wholeWord).toBe(false);
    });

    it("resets currentIndex when toggling wholeWord", () => {
      useSearchStore.setState({ currentIndex: 4, matchCount: 10 });
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("toggles useRegex on", () => {
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().useRegex).toBe(true);
    });

    it("toggles useRegex off", () => {
      useSearchStore.setState({ useRegex: true });
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().useRegex).toBe(false);
    });

    it("resets currentIndex when toggling useRegex", () => {
      useSearchStore.setState({ currentIndex: 1, matchCount: 3 });
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });
  });

  describe("setMatches", () => {
    it("updates matchCount and currentIndex", () => {
      useSearchStore.getState().setMatches(10, 3);
      const state = useSearchStore.getState();
      expect(state.matchCount).toBe(10);
      expect(state.currentIndex).toBe(3);
    });

    it("sets zero matches", () => {
      useSearchStore.getState().setMatches(0, -1);
      const state = useSearchStore.getState();
      expect(state.matchCount).toBe(0);
      expect(state.currentIndex).toBe(-1);
    });
  });

  describe("findNext", () => {
    it("advances to next match", () => {
      useSearchStore.setState({ matchCount: 5, currentIndex: 2 });
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(3);
    });

    it("wraps around to 0 when at last match", () => {
      useSearchStore.setState({ matchCount: 5, currentIndex: 4 });
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });

    it("does nothing when matchCount is 0", () => {
      useSearchStore.setState({ matchCount: 0, currentIndex: -1 });
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("wraps from -1 to 0 (initial state with matches)", () => {
      useSearchStore.setState({ matchCount: 3, currentIndex: -1 });
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });

    it("handles single match", () => {
      useSearchStore.setState({ matchCount: 1, currentIndex: 0 });
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });
  });

  describe("findPrevious", () => {
    it("moves to previous match", () => {
      useSearchStore.setState({ matchCount: 5, currentIndex: 3 });
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(2);
    });

    it("wraps around to last match when at index 0", () => {
      useSearchStore.setState({ matchCount: 5, currentIndex: 0 });
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(4);
    });

    it("does nothing when matchCount is 0", () => {
      useSearchStore.setState({ matchCount: 0, currentIndex: -1 });
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("wraps from -1 to last match", () => {
      useSearchStore.setState({ matchCount: 3, currentIndex: -1 });
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(2);
    });

    it("handles single match", () => {
      useSearchStore.setState({ matchCount: 1, currentIndex: 0 });
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });
  });

  describe("replaceCurrent", () => {
    it("dispatches search:replace-current event", () => {
      const handler = vi.fn();
      window.addEventListener("search:replace-current", handler);

      useSearchStore.getState().replaceCurrent();

      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener("search:replace-current", handler);
    });
  });

  describe("replaceAll", () => {
    it("dispatches search:replace-all event", () => {
      const handler = vi.fn();
      window.addEventListener("search:replace-all", handler);

      useSearchStore.getState().replaceAll();

      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener("search:replace-all", handler);
    });
  });

  describe("initial state", () => {
    it("has correct defaults", () => {
      const state = useSearchStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe("");
      expect(state.replaceText).toBe("");
      expect(state.caseSensitive).toBe(false);
      expect(state.wholeWord).toBe(false);
      expect(state.useRegex).toBe(false);
      expect(state.matchCount).toBe(0);
      expect(state.currentIndex).toBe(-1);
    });
  });

  describe("state independence", () => {
    it("setQuery does not affect other fields", () => {
      useSearchStore.setState({ caseSensitive: true, wholeWord: true });
      useSearchStore.getState().setQuery("test");
      const state = useSearchStore.getState();
      expect(state.caseSensitive).toBe(true);
      expect(state.wholeWord).toBe(true);
    });

    it("toggleCaseSensitive does not affect query", () => {
      useSearchStore.getState().setQuery("hello");
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().query).toBe("hello");
    });

    it("close does not reset query or options", () => {
      useSearchStore.getState().setQuery("search term");
      useSearchStore.setState({ caseSensitive: true });
      useSearchStore.getState().close();
      const state = useSearchStore.getState();
      expect(state.query).toBe("search term");
      expect(state.caseSensitive).toBe(true);
      expect(state.isOpen).toBe(false);
    });
  });
});
