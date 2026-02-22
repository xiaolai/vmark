/**
 * Tests for searchStore
 *
 * Covers: open/close/toggle, query & replace text, search option toggles
 * (case, whole word, regex), match navigation with wraparound, replace
 * event dispatching, and currentIndex reset on option changes.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSearchStore } from "../searchStore";

beforeEach(() => {
  useSearchStore.setState(useSearchStore.getInitialState());
});

describe("searchStore", () => {
  describe("initial state", () => {
    it("starts closed with empty query and defaults", () => {
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

    it("toggles isOpen from false to true", () => {
      useSearchStore.getState().toggle();
      expect(useSearchStore.getState().isOpen).toBe(true);
    });

    it("toggles isOpen from true to false", () => {
      useSearchStore.getState().open();
      useSearchStore.getState().toggle();
      expect(useSearchStore.getState().isOpen).toBe(false);
    });

    it("preserves query when closing (no state reset)", () => {
      useSearchStore.getState().setQuery("hello");
      useSearchStore.getState().close();
      expect(useSearchStore.getState().query).toBe("hello");
    });
  });

  describe("setQuery", () => {
    it("updates the query string", () => {
      useSearchStore.getState().setQuery("hello");
      expect(useSearchStore.getState().query).toBe("hello");
    });

    it("resets currentIndex to -1 on query change", () => {
      useSearchStore.getState().setMatches(5, 3);
      useSearchStore.getState().setQuery("new query");
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("accepts empty string", () => {
      useSearchStore.getState().setQuery("test");
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
      useSearchStore.getState().setReplaceText("text");
      useSearchStore.getState().setReplaceText("");
      expect(useSearchStore.getState().replaceText).toBe("");
    });
  });

  describe("search option toggles", () => {
    it("toggles caseSensitive", () => {
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().caseSensitive).toBe(true);
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().caseSensitive).toBe(false);
    });

    it("toggles wholeWord", () => {
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().wholeWord).toBe(true);
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().wholeWord).toBe(false);
    });

    it("toggles useRegex", () => {
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().useRegex).toBe(true);
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().useRegex).toBe(false);
    });

    it("resets currentIndex to -1 when toggling caseSensitive", () => {
      useSearchStore.getState().setMatches(10, 5);
      useSearchStore.getState().toggleCaseSensitive();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("resets currentIndex to -1 when toggling wholeWord", () => {
      useSearchStore.getState().setMatches(10, 5);
      useSearchStore.getState().toggleWholeWord();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("resets currentIndex to -1 when toggling useRegex", () => {
      useSearchStore.getState().setMatches(10, 5);
      useSearchStore.getState().toggleRegex();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });
  });

  describe("setMatches", () => {
    it("sets matchCount and currentIndex", () => {
      useSearchStore.getState().setMatches(7, 2);
      const state = useSearchStore.getState();
      expect(state.matchCount).toBe(7);
      expect(state.currentIndex).toBe(2);
    });

    it("handles zero matches", () => {
      useSearchStore.getState().setMatches(0, -1);
      const state = useSearchStore.getState();
      expect(state.matchCount).toBe(0);
      expect(state.currentIndex).toBe(-1);
    });
  });

  describe("findNext", () => {
    it("advances to the next match", () => {
      useSearchStore.getState().setMatches(5, 0);
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(1);
    });

    it("wraps around to 0 after the last match", () => {
      useSearchStore.getState().setMatches(5, 4);
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });

    it("does nothing when matchCount is 0", () => {
      useSearchStore.getState().setMatches(0, -1);
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("wraps from -1 to 0 (first navigation after query change)", () => {
      useSearchStore.getState().setMatches(3, -1);
      // currentIndex is -1, so -1 + 1 = 0 which is < matchCount(3)
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });

    it("handles single match (stays at 0)", () => {
      useSearchStore.getState().setMatches(1, 0);
      useSearchStore.getState().findNext();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });
  });

  describe("findPrevious", () => {
    it("moves to the previous match", () => {
      useSearchStore.getState().setMatches(5, 3);
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(2);
    });

    it("wraps to the last match when at index 0", () => {
      useSearchStore.getState().setMatches(5, 0);
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(4);
    });

    it("does nothing when matchCount is 0", () => {
      useSearchStore.getState().setMatches(0, -1);
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(-1);
    });

    it("wraps from -1 to last match", () => {
      useSearchStore.getState().setMatches(3, -1);
      // currentIndex -1, so -1 - 1 = -2 < 0, wraps to matchCount - 1 = 2
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(2);
    });

    it("handles single match (stays at 0)", () => {
      useSearchStore.getState().setMatches(1, 0);
      useSearchStore.getState().findPrevious();
      expect(useSearchStore.getState().currentIndex).toBe(0);
    });
  });

  describe("replaceCurrent", () => {
    it("dispatches search:replace-current event", () => {
      const handler = vi.fn();
      window.addEventListener("search:replace-current", handler);

      useSearchStore.getState().replaceCurrent();
      expect(handler).toHaveBeenCalledOnce();

      window.removeEventListener("search:replace-current", handler);
    });
  });

  describe("replaceAll", () => {
    it("dispatches search:replace-all event", () => {
      const handler = vi.fn();
      window.addEventListener("search:replace-all", handler);

      useSearchStore.getState().replaceAll();
      expect(handler).toHaveBeenCalledOnce();

      window.removeEventListener("search:replace-all", handler);
    });
  });
});
