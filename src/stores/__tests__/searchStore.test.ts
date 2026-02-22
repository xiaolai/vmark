/**
 * Tests for searchStore
 *
 * Covers: open/close/toggle, query & replaceText setters, option toggles
 * (case, word, regex), match navigation with wraparound, replace event
 * dispatch, and currentIndex reset on query/option changes.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSearchStore } from "../searchStore";

beforeEach(() => {
  useSearchStore.setState(useSearchStore.getInitialState());
});

describe("searchStore", () => {
  // --- open / close / toggle ---

  describe("open / close / toggle", () => {
    it("opens the search bar", () => {
      useSearchStore.getState().open();
      expect(useSearchStore.getState().isOpen).toBe(true);
    });

    it("closes the search bar", () => {
      useSearchStore.getState().open();
      useSearchStore.getState().close();
      expect(useSearchStore.getState().isOpen).toBe(false);
    });

    it("toggles isOpen", () => {
      useSearchStore.getState().toggle();
      expect(useSearchStore.getState().isOpen).toBe(true);
      useSearchStore.getState().toggle();
      expect(useSearchStore.getState().isOpen).toBe(false);
    });

    it("preserves query when closing", () => {
      useSearchStore.getState().setQuery("hello");
      useSearchStore.getState().close();
      expect(useSearchStore.getState().query).toBe("hello");
    });
  });

  // --- setQuery / setReplaceText ---

  describe("setQuery", () => {
    it("updates the query", () => {
      useSearchStore.getState().setQuery("hello");
      expect(useSearchStore.getState().query).toBe("hello");
    });

    it("resets currentIndex to -1", () => {
      useSearchStore.setState({ currentIndex: 3 });
      useSearchStore.getState().setQuery("new");
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("accepts empty string", () => {
      useSearchStore.getState().setQuery("hello");
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
      useSearchStore.getState().setReplaceText("world");
      useSearchStore.getState().setReplaceText("");
      expect(useSearchStore.getState().replaceText).toBe("");
    });
  });

  // --- Option toggles ---

  describe("toggleCaseSensitive", () => {
    it("toggles caseSensitive flag", () => {
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().caseSensitive).toBe(true);
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().caseSensitive).toBe(false);
    });

    it("resets currentIndex to -1", () => {
      useSearchStore.setState({ currentIndex: 5 });
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });
  });

  describe("toggleWholeWord", () => {
    it("toggles wholeWord flag", () => {
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().wholeWord).toBe(true);
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().wholeWord).toBe(false);
    });

    it("resets currentIndex to -1", () => {
      useSearchStore.setState({ currentIndex: 2 });
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });
  });

  describe("toggleRegex", () => {
    it("toggles useRegex flag", () => {
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().useRegex).toBe(true);
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().useRegex).toBe(false);
    });

    it("resets currentIndex to -1", () => {
      useSearchStore.setState({ currentIndex: 4 });
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });
  });

  // --- setMatches ---

  describe("setMatches", () => {
    it("sets matchCount and currentIndex", () => {
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

  // --- findNext / findPrevious ---

  describe("findNext", () => {
    it("advances to the next match", () => {
      useSearchStore.setState({ matchCount: 5, currentIndex: 2 });
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(3);
    });

    it("wraps around to 0 at the end", () => {
      useSearchStore.setState({ matchCount: 5, currentIndex: 4 });
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });

    it("does nothing when matchCount is 0", () => {
      useSearchStore.setState({ matchCount: 0, currentIndex: -1 });
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("wraps from -1 to 0 (first navigation after query change)", () => {
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
    it("goes to the previous match", () => {
      useSearchStore.setState({ matchCount: 5, currentIndex: 3 });
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(2);
    });

    it("wraps around to last match from index 0", () => {
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

  // --- replaceCurrent / replaceAll ---

  describe("replaceCurrent", () => {
    it("dispatches search:replace-current event", () => {
      const spy = vi.spyOn(window, "dispatchEvent");
      useSearchStore.getState().replaceCurrent();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "search:replace-current" }),
      );
      spy.mockRestore();
    });
  });

  describe("replaceAll", () => {
    it("dispatches search:replace-all event", () => {
      const spy = vi.spyOn(window, "dispatchEvent");
      useSearchStore.getState().replaceAll();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "search:replace-all" }),
      );
      spy.mockRestore();
    });
  });

  // --- Initial state ---

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
});
