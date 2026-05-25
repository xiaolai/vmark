/**
 * AI Suggestion Plugin Tests
 *
 * Tests pure/isolated helper functions from the aiSuggestion tiptap plugin:
 * - isValidPosition: boundary validation for suggestion positions
 * - getDecorationClass: CSS class construction for decoration types
 * - isButtonEvent: DOM event targeting for suggestion buttons
 *
 * Also tests the aiSuggestionStore for state management logic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { AiSuggestion } from "../types";
import { AI_SUGGESTION_EVENTS } from "../types";
import { isValidPosition, getDecorationClass, isButtonEvent } from "../tiptap";
import {
  useAiSuggestionStore,
  resetAiSuggestionStore,
} from "@/stores/aiStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    id: "test-1",
    tabId: "tab-1",
    type: "insert",
    from: 0,
    to: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isValidPosition
// ---------------------------------------------------------------------------

describe("isValidPosition", () => {
  const docSize = 100;

  it.each([
    { from: 0, to: 0, expected: true, label: "zero-length at start" },
    { from: 0, to: 100, expected: true, label: "full document range" },
    { from: 50, to: 50, expected: true, label: "zero-length in middle" },
    { from: 10, to: 50, expected: true, label: "normal range" },
    { from: 100, to: 100, expected: true, label: "at document end" },
    { from: -1, to: 10, expected: false, label: "negative from" },
    { from: 0, to: 101, expected: false, label: "to past doc end" },
    { from: 50, to: 40, expected: false, label: "from > to (inverted)" },
    { from: -5, to: -1, expected: false, label: "both negative" },
    { from: 101, to: 105, expected: false, label: "both past doc end" },
  ])("$label (from=$from, to=$to) -> $expected", ({ from, to, expected }) => {
    const suggestion = makeSuggestion({ from, to });
    expect(isValidPosition(suggestion, docSize)).toBe(expected);
  });

  it("handles zero-size document", () => {
    expect(isValidPosition(makeSuggestion({ from: 0, to: 0 }), 0)).toBe(true);
    expect(isValidPosition(makeSuggestion({ from: 0, to: 1 }), 0)).toBe(false);
  });

  it("handles very large document size", () => {
    const large = 1_000_000;
    expect(
      isValidPosition(makeSuggestion({ from: 0, to: large }), large),
    ).toBe(true);
    expect(
      isValidPosition(makeSuggestion({ from: large, to: large }), large),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDecorationClass
// ---------------------------------------------------------------------------

describe("getDecorationClass", () => {
  it.each([
    {
      type: "insert" as const,
      focused: false,
      expected: "ai-suggestion ai-suggestion-insert",
    },
    {
      type: "insert" as const,
      focused: true,
      expected: "ai-suggestion ai-suggestion-insert ai-suggestion-focused",
    },
    {
      type: "delete" as const,
      focused: false,
      expected: "ai-suggestion ai-suggestion-delete",
    },
    {
      type: "delete" as const,
      focused: true,
      expected: "ai-suggestion ai-suggestion-delete ai-suggestion-focused",
    },
    {
      type: "replace" as const,
      focused: false,
      expected: "ai-suggestion ai-suggestion-replace",
    },
    {
      type: "replace" as const,
      focused: true,
      expected: "ai-suggestion ai-suggestion-replace ai-suggestion-focused",
    },
  ])("type=$type, focused=$focused -> correct class", ({ type, focused, expected }) => {
    const suggestion = makeSuggestion({ type });
    expect(getDecorationClass(suggestion, focused)).toBe(expected);
  });

  it("always includes base class 'ai-suggestion'", () => {
    for (const type of ["insert", "delete", "replace"] as const) {
      const result = getDecorationClass(makeSuggestion({ type }), false);
      expect(result).toContain("ai-suggestion");
    }
  });
});

// ---------------------------------------------------------------------------
// isButtonEvent
// ---------------------------------------------------------------------------

describe("isButtonEvent", () => {
  it("returns true when target is inside a suggestion button", () => {
    const container = document.createElement("div");
    const btn = document.createElement("button");
    btn.className = "ai-suggestion-btn";
    const icon = document.createElement("span");
    btn.appendChild(icon);
    container.appendChild(btn);

    const event = new MouseEvent("mousedown");
    Object.defineProperty(event, "target", { value: icon });
    expect(isButtonEvent(event)).toBe(true);
  });

  it("returns true when target IS the suggestion button", () => {
    const btn = document.createElement("button");
    btn.className = "ai-suggestion-btn ai-suggestion-btn-accept";
    document.body.appendChild(btn);

    const event = new MouseEvent("mousedown");
    Object.defineProperty(event, "target", { value: btn });
    expect(isButtonEvent(event)).toBe(true);

    document.body.removeChild(btn);
  });

  it("returns false when target is outside suggestion buttons", () => {
    const div = document.createElement("div");
    div.className = "some-other-element";
    document.body.appendChild(div);

    const event = new MouseEvent("mousedown");
    Object.defineProperty(event, "target", { value: div });
    expect(isButtonEvent(event)).toBe(false);

    document.body.removeChild(div);
  });

  it("returns false when target is not an Element", () => {
    const event = new MouseEvent("mousedown");
    Object.defineProperty(event, "target", { value: null });
    expect(isButtonEvent(event)).toBe(false);
  });

  it("returns false for text node target", () => {
    const textNode = document.createTextNode("hello");
    const event = new MouseEvent("mousedown");
    Object.defineProperty(event, "target", { value: textNode });
    expect(isButtonEvent(event)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AI_SUGGESTION_EVENTS constants
// ---------------------------------------------------------------------------

describe("AI_SUGGESTION_EVENTS", () => {
  it("has all required event names", () => {
    expect(AI_SUGGESTION_EVENTS.ADDED).toBe("ai-suggestion:added");
    expect(AI_SUGGESTION_EVENTS.ACCEPT).toBe("ai-suggestion:accept");
    expect(AI_SUGGESTION_EVENTS.REJECT).toBe("ai-suggestion:reject");
    expect(AI_SUGGESTION_EVENTS.ACCEPT_ALL).toBe("ai-suggestion:accept-all");
    expect(AI_SUGGESTION_EVENTS.REJECT_ALL).toBe("ai-suggestion:reject-all");
    expect(AI_SUGGESTION_EVENTS.FOCUS_CHANGED).toBe("ai-suggestion:focus-changed");
  });

  it("event names are prefixed with 'ai-suggestion:'", () => {
    for (const value of Object.values(AI_SUGGESTION_EVENTS)) {
      expect(value).toMatch(/^ai-suggestion:/);
    }
  });
});

// ---------------------------------------------------------------------------
// aiSuggestionStore
// ---------------------------------------------------------------------------

describe("aiSuggestionStore", () => {
  beforeEach(() => {
    resetAiSuggestionStore();
  });

  it("starts with empty state", () => {
    const state = useAiSuggestionStore.getState();
    expect(state.suggestions.size).toBe(0);
    expect(state.focusedSuggestionId).toBeNull();
  });

  it("addSuggestion creates a suggestion and returns id", () => {
    const id = useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "insert",
      from: 0,
      to: 0,
      newContent: "hello",
    });
    expect(id).toBeTruthy();
    const state = useAiSuggestionStore.getState();
    expect(state.suggestions.size).toBe(1);
    expect(state.suggestions.get(id)?.newContent).toBe("hello");
  });

  it("auto-focuses first suggestion when none focused", () => {
    const id = useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "insert",
      from: 0,
      to: 0,
    });
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id);
  });

  it("does not override focus when adding subsequent suggestions", () => {
    const id1 = useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "insert",
      from: 0,
      to: 0,
    });
    useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "insert",
      from: 10,
      to: 10,
    });
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);
  });

  it("removeSuggestion removes and advances focus", () => {
    const id1 = useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "insert",
      from: 0,
      to: 0,
    });
    const id2 = useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "insert",
      from: 10,
      to: 10,
    });
    // Focus is on id1 (auto-focused)
    useAiSuggestionStore.getState().removeSuggestion(id1);
    const state = useAiSuggestionStore.getState();
    expect(state.suggestions.size).toBe(1);
    expect(state.focusedSuggestionId).toBe(id2);
  });

  it("removeSuggestion is a no-op for unknown id", () => {
    useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "insert",
      from: 0,
      to: 0,
    });
    useAiSuggestionStore.getState().removeSuggestion("nonexistent");
    expect(useAiSuggestionStore.getState().suggestions.size).toBe(1);
  });

  it("getSortedSuggestions returns suggestions ordered by from position", () => {
    const store = useAiSuggestionStore.getState();
    store.addSuggestion({ tabId: "t", type: "insert", from: 50, to: 50 });
    store.addSuggestion({ tabId: "t", type: "insert", from: 10, to: 10 });
    store.addSuggestion({ tabId: "t", type: "insert", from: 30, to: 30 });

    const sorted = useAiSuggestionStore.getState().getSortedSuggestions();
    expect(sorted.map((s) => s.from)).toEqual([10, 30, 50]);
  });

  it("clearForTab removes only suggestions for the specified tab", () => {
    const store = useAiSuggestionStore.getState();
    store.addSuggestion({ tabId: "tab-a", type: "insert", from: 0, to: 0 });
    const idB = store.addSuggestion({ tabId: "tab-b", type: "insert", from: 10, to: 10 });

    useAiSuggestionStore.getState().clearForTab("tab-a");
    const state = useAiSuggestionStore.getState();
    expect(state.suggestions.size).toBe(1);
    expect(state.suggestions.has(idB)).toBe(true);
  });

  it("clearAll removes all suggestions and resets focus", () => {
    const store = useAiSuggestionStore.getState();
    store.addSuggestion({ tabId: "t", type: "insert", from: 0, to: 0 });
    store.addSuggestion({ tabId: "t", type: "delete", from: 5, to: 10 });

    useAiSuggestionStore.getState().clearAll();
    const state = useAiSuggestionStore.getState();
    expect(state.suggestions.size).toBe(0);
    expect(state.focusedSuggestionId).toBeNull();
  });

  it("navigateNext cycles through suggestions", () => {
    const store = useAiSuggestionStore.getState();
    store.addSuggestion({ tabId: "t", type: "insert", from: 10, to: 10 });
    store.addSuggestion({ tabId: "t", type: "insert", from: 20, to: 20 });
    store.addSuggestion({ tabId: "t", type: "insert", from: 30, to: 30 });

    const sorted = useAiSuggestionStore.getState().getSortedSuggestions();

    // First suggestion is auto-focused
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(sorted[0].id);

    useAiSuggestionStore.getState().navigateNext();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(sorted[1].id);

    useAiSuggestionStore.getState().navigateNext();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(sorted[2].id);

    // Wraps around
    useAiSuggestionStore.getState().navigateNext();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(sorted[0].id);
  });

  it("navigatePrevious cycles backward through suggestions", () => {
    const store = useAiSuggestionStore.getState();
    store.addSuggestion({ tabId: "t", type: "insert", from: 10, to: 10 });
    store.addSuggestion({ tabId: "t", type: "insert", from: 20, to: 20 });

    const sorted = useAiSuggestionStore.getState().getSortedSuggestions();

    // Auto-focused on first
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(sorted[0].id);

    // Previous from first wraps to last
    useAiSuggestionStore.getState().navigatePrevious();
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(sorted[1].id);
  });

  it("getSuggestion returns undefined for unknown id", () => {
    expect(useAiSuggestionStore.getState().getSuggestion("nope")).toBeUndefined();
  });

  it("focusSuggestion sets the focused id", () => {
    const id = useAiSuggestionStore.getState().addSuggestion({
      tabId: "t",
      type: "insert",
      from: 0,
      to: 0,
    });
    useAiSuggestionStore.getState().focusSuggestion(null);
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBeNull();

    useAiSuggestionStore.getState().focusSuggestion(id);
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id);
  });
});
