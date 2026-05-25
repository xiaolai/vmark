/**
 * Tests for aiSuggestionStore
 *
 * Covers: initial state, resetState, state transitions (add/accept/reject/remove),
 * navigation, clearForTab, clearAll, and multiple reset cycles.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useAiSuggestionStore,
  resetAiSuggestionStore,
  initSuggestionTabWatcher,
} from "../aiStore";
import { AI_SUGGESTION_EVENTS } from "@/plugins/aiSuggestion/types";
import type { SuggestionType } from "@/plugins/aiSuggestion/types";

// Spy on window.dispatchEvent so we can verify CustomEvents without side effects
const dispatchSpy = vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);

function addTestSuggestion(
  overrides: {
    tabId?: string;
    type?: SuggestionType;
    from?: number;
    to?: number;
    newContent?: string;
    originalContent?: string;
  } = {}
): string {
  return useAiSuggestionStore.getState().addSuggestion({
    tabId: overrides.tabId ?? "tab-1",
    type: overrides.type ?? "replace",
    from: overrides.from ?? 0,
    to: overrides.to ?? 5,
    newContent: overrides.newContent ?? "new",
    originalContent: overrides.originalContent ?? "old",
  });
}

beforeEach(() => {
  resetAiSuggestionStore();
  dispatchSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------
describe("initial state", () => {
  it("starts with an empty suggestions map", () => {
    const { suggestions } = useAiSuggestionStore.getState();
    expect(suggestions).toBeInstanceOf(Map);
    expect(suggestions.size).toBe(0);
  });

  it("starts with no focused suggestion", () => {
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resetAiSuggestionStore (resetState)
// ---------------------------------------------------------------------------
describe("resetAiSuggestionStore", () => {
  it("clears all suggestions back to defaults", () => {
    addTestSuggestion();
    addTestSuggestion({ from: 10, to: 15 });
    expect(useAiSuggestionStore.getState().suggestions.size).toBe(2);

    resetAiSuggestionStore();

    const state = useAiSuggestionStore.getState();
    expect(state.suggestions.size).toBe(0);
    expect(state.focusedSuggestionId).toBeNull();
  });

  it("resets the suggestion counter so IDs restart", () => {
    addTestSuggestion();
    resetAiSuggestionStore();

    const id = addTestSuggestion();
    // After reset, counter restarts at 1
    expect(id).toMatch(/^ai-suggestion-1-/);
  });

  it("multiple reset cycles do not leak state", () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      const id = addTestSuggestion();
      expect(useAiSuggestionStore.getState().suggestions.size).toBe(1);
      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id);

      resetAiSuggestionStore();

      expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// addSuggestion
// ---------------------------------------------------------------------------
describe("addSuggestion", () => {
  it("returns a unique ID and stores the suggestion", () => {
    const id = addTestSuggestion();
    expect(id).toBeTruthy();
    const s = useAiSuggestionStore.getState().getSuggestion(id);
    expect(s).toBeDefined();
    expect(s!.tabId).toBe("tab-1");
    expect(s!.type).toBe("replace");
    expect(s!.from).toBe(0);
    expect(s!.to).toBe(5);
  });

  it("auto-focuses the first suggestion", () => {
    const id = addTestSuggestion();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id);
  });

  it("does not override focus when adding a second suggestion", () => {
    const first = addTestSuggestion();
    addTestSuggestion({ from: 10, to: 15 });
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(first);
  });

  it("dispatches ADDED event", () => {
    const id = addTestSuggestion();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AI_SUGGESTION_EVENTS.ADDED,
        detail: expect.objectContaining({ id }),
      })
    );
  });

  it("stores createdAt timestamp", () => {
    const before = Date.now();
    const id = addTestSuggestion();
    const after = Date.now();
    const s = useAiSuggestionStore.getState().getSuggestion(id)!;
    expect(s.createdAt).toBeGreaterThanOrEqual(before);
    expect(s.createdAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// acceptSuggestion
// ---------------------------------------------------------------------------
describe("acceptSuggestion", () => {
  it("removes the suggestion and dispatches ACCEPT event", () => {
    const id = addTestSuggestion();
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().acceptSuggestion(id);

    expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: AI_SUGGESTION_EVENTS.ACCEPT })
    );
  });

  it("is a no-op for unknown ID", () => {
    addTestSuggestion();
    dispatchSpy.mockClear();
    useAiSuggestionStore.getState().acceptSuggestion("nonexistent");
    expect(useAiSuggestionStore.getState().suggestions.size).toBe(1);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("advances focus to next suggestion after accepting focused one", () => {
    const id1 = addTestSuggestion({ from: 0, to: 5 });
    const id2 = addTestSuggestion({ from: 10, to: 15 });
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);

    useAiSuggestionStore.getState().acceptSuggestion(id1);
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// rejectSuggestion
// ---------------------------------------------------------------------------
describe("rejectSuggestion", () => {
  it("removes the suggestion and dispatches REJECT event", () => {
    const id = addTestSuggestion();
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().rejectSuggestion(id);

    expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: AI_SUGGESTION_EVENTS.REJECT })
    );
  });

  it("is a no-op for unknown ID", () => {
    useAiSuggestionStore.getState().rejectSuggestion("nonexistent");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeSuggestion (no event dispatch for accept/reject, just removal)
// ---------------------------------------------------------------------------
describe("removeSuggestion", () => {
  it("removes without dispatching accept/reject events", () => {
    const id = addTestSuggestion();
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().removeSuggestion(id);

    expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    // Should NOT have accept or reject events
    const eventTypes = dispatchSpy.mock.calls.map(
      (call) => (call[0] as CustomEvent).type
    );
    expect(eventTypes).not.toContain(AI_SUGGESTION_EVENTS.ACCEPT);
    expect(eventTypes).not.toContain(AI_SUGGESTION_EVENTS.REJECT);
  });

  it("is a no-op for unknown ID", () => {
    useAiSuggestionStore.getState().removeSuggestion("nonexistent");
    expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
  });

  it("dispatches FOCUS_CHANGED when focus shifts", () => {
    const id1 = addTestSuggestion({ from: 0, to: 5 });
    addTestSuggestion({ from: 10, to: 15 });
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().removeSuggestion(id1);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: AI_SUGGESTION_EVENTS.FOCUS_CHANGED })
    );
  });
});

// ---------------------------------------------------------------------------
// acceptAll / rejectAll
// ---------------------------------------------------------------------------
describe("acceptAll", () => {
  it("clears all suggestions and dispatches ACCEPT_ALL", () => {
    addTestSuggestion({ from: 0, to: 5 });
    addTestSuggestion({ from: 10, to: 15 });
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().acceptAll();

    expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: AI_SUGGESTION_EVENTS.ACCEPT_ALL })
    );
  });

  it("provides suggestions in reverse position order", () => {
    addTestSuggestion({ from: 0, to: 5 });
    addTestSuggestion({ from: 10, to: 15 });
    addTestSuggestion({ from: 5, to: 8 });
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().acceptAll();

    const event = dispatchSpy.mock.calls.find(
      (c) => (c[0] as CustomEvent).type === AI_SUGGESTION_EVENTS.ACCEPT_ALL
    );
    const suggestions = (event![0] as CustomEvent).detail.suggestions;
    // Reverse position order: highest from first
    expect(suggestions[0].from).toBe(10);
    expect(suggestions[1].from).toBe(5);
    expect(suggestions[2].from).toBe(0);
  });

  it("is a no-op when there are no suggestions", () => {
    useAiSuggestionStore.getState().acceptAll();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe("rejectAll", () => {
  it("clears all suggestions and dispatches REJECT_ALL", () => {
    addTestSuggestion();
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().rejectAll();

    expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: AI_SUGGESTION_EVENTS.REJECT_ALL })
    );
  });

  it("is a no-op when there are no suggestions", () => {
    useAiSuggestionStore.getState().rejectAll();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// focusSuggestion / navigation
// ---------------------------------------------------------------------------
describe("focusSuggestion", () => {
  it("sets focusedSuggestionId and dispatches event", () => {
    const id = addTestSuggestion();
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().focusSuggestion(id);

    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: AI_SUGGESTION_EVENTS.FOCUS_CHANGED })
    );
  });

  it("sets null without dispatching event", () => {
    addTestSuggestion();
    dispatchSpy.mockClear();

    useAiSuggestionStore.getState().focusSuggestion(null);

    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: AI_SUGGESTION_EVENTS.FOCUS_CHANGED })
    );
  });
});

describe("navigateNext", () => {
  it("wraps around to the first suggestion", () => {
    addTestSuggestion({ from: 0, to: 5 });
    const id2 = addTestSuggestion({ from: 10, to: 15 });
    // Focus second (last)
    useAiSuggestionStore.getState().focusSuggestion(id2);

    useAiSuggestionStore.getState().navigateNext();

    const sorted = useAiSuggestionStore.getState().getSortedSuggestions();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(sorted[0].id);
  });

  it("is a no-op with empty suggestions", () => {
    useAiSuggestionStore.getState().navigateNext();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
  });
});

describe("navigatePrevious", () => {
  it("wraps around to the last suggestion", () => {
    const id1 = addTestSuggestion({ from: 0, to: 5 });
    addTestSuggestion({ from: 10, to: 15 });
    // Focus first
    useAiSuggestionStore.getState().focusSuggestion(id1);

    useAiSuggestionStore.getState().navigatePrevious();

    const sorted = useAiSuggestionStore.getState().getSortedSuggestions();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(
      sorted[sorted.length - 1].id
    );
  });

  it("is a no-op with empty suggestions", () => {
    useAiSuggestionStore.getState().navigatePrevious();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSortedSuggestions / getSuggestion
// ---------------------------------------------------------------------------
describe("getSortedSuggestions", () => {
  it("returns suggestions sorted by from position", () => {
    addTestSuggestion({ from: 20, to: 25 });
    addTestSuggestion({ from: 5, to: 10 });
    addTestSuggestion({ from: 10, to: 15 });

    const sorted = useAiSuggestionStore.getState().getSortedSuggestions();
    expect(sorted.map((s) => s.from)).toEqual([5, 10, 20]);
  });

  it("returns empty array when no suggestions", () => {
    expect(useAiSuggestionStore.getState().getSortedSuggestions()).toEqual([]);
  });
});

describe("getSuggestion", () => {
  it("returns undefined for unknown ID", () => {
    expect(useAiSuggestionStore.getState().getSuggestion("nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// clearForTab
// ---------------------------------------------------------------------------
describe("clearForTab", () => {
  it("only removes suggestions belonging to the specified tab", () => {
    addTestSuggestion({ tabId: "tab-1", from: 0, to: 5 });
    const kept = addTestSuggestion({ tabId: "tab-2", from: 10, to: 15 });

    useAiSuggestionStore.getState().clearForTab("tab-1");

    expect(useAiSuggestionStore.getState().suggestions.size).toBe(1);
    expect(useAiSuggestionStore.getState().getSuggestion(kept)).toBeDefined();
  });

  it("clears focus when the focused suggestion is removed", () => {
    addTestSuggestion({ tabId: "tab-1" });

    useAiSuggestionStore.getState().clearForTab("tab-1");

    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
  });

  it("preserves focus when focused suggestion belongs to a different tab", () => {
    addTestSuggestion({ tabId: "tab-1", from: 0, to: 5 });
    const other = addTestSuggestion({ tabId: "tab-2", from: 10, to: 15 });
    useAiSuggestionStore.getState().focusSuggestion(other);

    useAiSuggestionStore.getState().clearForTab("tab-1");

    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(other);
  });

  it("is a no-op when tab has no suggestions", () => {
    addTestSuggestion({ tabId: "tab-1" });
    const sizeBefore = useAiSuggestionStore.getState().suggestions.size;

    useAiSuggestionStore.getState().clearForTab("tab-999");

    expect(useAiSuggestionStore.getState().suggestions.size).toBe(sizeBefore);
  });
});

// ---------------------------------------------------------------------------
// clearAll
// ---------------------------------------------------------------------------
describe("clearAll", () => {
  it("removes all suggestions and clears focus", () => {
    addTestSuggestion({ tabId: "tab-1" });
    addTestSuggestion({ tabId: "tab-2" });

    useAiSuggestionStore.getState().clearAll();

    expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// initSuggestionTabWatcher
// ---------------------------------------------------------------------------
describe("initSuggestionTabWatcher", () => {
  it("clears suggestions for previous tab when tab changes", () => {
    addTestSuggestion({ tabId: "tab-A", from: 0, to: 5 });
    addTestSuggestion({ tabId: "tab-B", from: 10, to: 15 });

    let subscriberCallback: ((state: { activeTabId: Record<string, string | null> }) => void) | null = null;
    const mockSubscribe = vi.fn((cb: (state: { activeTabId: Record<string, string | null> }) => void) => {
      subscriberCallback = cb;
      return () => {};
    });

    initSuggestionTabWatcher(mockSubscribe);
    expect(mockSubscribe).toHaveBeenCalledOnce();

    // Simulate initial tab state
    subscriberCallback!({ activeTabId: { main: "tab-A" } });

    // Simulate switching to tab-B — should clear tab-A suggestions
    subscriberCallback!({ activeTabId: { main: "tab-B" } });

    // tab-A suggestions should be cleared
    const remaining = useAiSuggestionStore.getState().getSortedSuggestions();
    expect(remaining.every((s) => s.tabId === "tab-B")).toBe(true);
  });

  it("does not initialize twice when called consecutively", () => {
    // resetAiSuggestionStore was called in beforeEach, resetting the flag.
    // Initialize once:
    const firstSubscribe = vi.fn(() => () => {});
    initSuggestionTabWatcher(firstSubscribe);
    expect(firstSubscribe).toHaveBeenCalledOnce();

    // Second call should be a no-op:
    const secondSubscribe = vi.fn(() => () => {});
    initSuggestionTabWatcher(secondSubscribe);
    expect(secondSubscribe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// navigatePrevious — currentIndex > 0 branch (line 256 right-hand side)
// ---------------------------------------------------------------------------
describe("navigatePrevious — from middle of list", () => {
  it("moves to previous suggestion when focused is not first (covers line 256 right branch)", () => {
    const id1 = addTestSuggestion({ from: 0, to: 5 });
    const id2 = addTestSuggestion({ from: 10, to: 15 });
    const id3 = addTestSuggestion({ from: 20, to: 25 });

    // Focus the last suggestion (index 2 in sorted order)
    useAiSuggestionStore.getState().focusSuggestion(id3);
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id3);

    // navigatePrevious: currentIndex = 2 > 0, so prevIndex = 2 - 1 = 1
    useAiSuggestionStore.getState().navigatePrevious();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id2);

    // navigatePrevious again: currentIndex = 1 > 0, so prevIndex = 0
    useAiSuggestionStore.getState().navigatePrevious();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);
  });
});

// ---------------------------------------------------------------------------
// navigateNext/navigatePrevious with null focus
// ---------------------------------------------------------------------------
describe("navigateNext with null focus", () => {
  it("focuses the first suggestion when no current focus", () => {
    addTestSuggestion({ from: 10, to: 15 });
    addTestSuggestion({ from: 0, to: 5 });

    // Clear focus manually
    useAiSuggestionStore.setState({ focusedSuggestionId: null });

    useAiSuggestionStore.getState().navigateNext();

    // Should go to first sorted suggestion (from: 0)
    const sorted = useAiSuggestionStore.getState().getSortedSuggestions();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(sorted[0].id);
  });
});

describe("navigatePrevious with null focus", () => {
  it("focuses the first suggestion when no current focus", () => {
    addTestSuggestion({ from: 10, to: 15 });
    addTestSuggestion({ from: 0, to: 5 });

    // Clear focus manually
    useAiSuggestionStore.setState({ focusedSuggestionId: null });

    useAiSuggestionStore.getState().navigatePrevious();

    // Should wrap: currentIndex is 0, prevIndex = sorted.length - 1
    const sorted = useAiSuggestionStore.getState().getSortedSuggestions();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(
      sorted[sorted.length - 1].id
    );
  });
});

// ---------------------------------------------------------------------------
// deleteAndUpdateFocus — non-focused suggestion removed
// ---------------------------------------------------------------------------
describe("deleteAndUpdateFocus edge cases", () => {
  it("preserves focus when removing a non-focused suggestion", () => {
    const id1 = addTestSuggestion({ from: 0, to: 5 });
    const id2 = addTestSuggestion({ from: 10, to: 15 });

    // Focus is on id1 (first added)
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);

    // Remove id2 (not focused)
    useAiSuggestionStore.getState().acceptSuggestion(id2);

    // Focus should remain on id1
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);
  });

  it("sorts remaining suggestions by position when focused is deleted", () => {
    // Add 3 suggestions: positions 20, 5, 10
    const id1 = addTestSuggestion({ from: 20, to: 25 });
    const id2 = addTestSuggestion({ from: 5, to: 10 });
    addTestSuggestion({ from: 10, to: 15 });

    // Focus on id1 (from: 20)
    useAiSuggestionStore.getState().focusSuggestion(id1);
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);

    // Delete focused suggestion — sort callback runs on 2 remaining
    useAiSuggestionStore.getState().acceptSuggestion(id1);

    // Focus should move to the first by position (from: 5 = id2)
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id2);
  });

  it("sets focus to null when removing the last suggestion", () => {
    const id = addTestSuggestion({ from: 0, to: 5 });

    useAiSuggestionStore.getState().acceptSuggestion(id);

    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();
  });
});
