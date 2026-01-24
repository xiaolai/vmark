import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useAiSuggestionStore } from "./aiSuggestionStore";

describe("aiSuggestionStore", () => {
  beforeEach(() => {
    useAiSuggestionStore.getState().clearAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    useAiSuggestionStore.getState().clearAll();
  });

  it("has correct initial state", () => {
    const state = useAiSuggestionStore.getState();

    expect(state.suggestions.size).toBe(0);
    expect(state.focusedSuggestionId).toBeNull();
  });

  describe("addSuggestion", () => {
    it("adds an insert suggestion", () => {
      const { addSuggestion } = useAiSuggestionStore.getState();

      const id = addSuggestion({
        type: "insert",
        from: 10,
        to: 20,
        newContent: "Hello World",
      });

      const state = useAiSuggestionStore.getState();
      expect(state.suggestions.size).toBe(1);
      expect(id).toMatch(/^ai-suggestion-/);

      const suggestion = state.suggestions.get(id);
      expect(suggestion).toBeDefined();
      expect(suggestion?.type).toBe("insert");
      expect(suggestion?.from).toBe(10);
      expect(suggestion?.to).toBe(20);
      expect(suggestion?.newContent).toBe("Hello World");
    });

    it("adds a replace suggestion with originalContent", () => {
      const { addSuggestion } = useAiSuggestionStore.getState();

      const id = addSuggestion({
        type: "replace",
        from: 5,
        to: 15,
        newContent: "new text",
        originalContent: "old text",
      });

      const suggestion = useAiSuggestionStore.getState().suggestions.get(id);
      expect(suggestion?.type).toBe("replace");
      expect(suggestion?.originalContent).toBe("old text");
      expect(suggestion?.newContent).toBe("new text");
    });

    it("adds a delete suggestion", () => {
      const { addSuggestion } = useAiSuggestionStore.getState();

      const id = addSuggestion({
        type: "delete",
        from: 0,
        to: 10,
        originalContent: "deleted text",
      });

      const suggestion = useAiSuggestionStore.getState().suggestions.get(id);
      expect(suggestion?.type).toBe("delete");
      expect(suggestion?.originalContent).toBe("deleted text");
    });

    it("auto-focuses first suggestion", () => {
      const { addSuggestion } = useAiSuggestionStore.getState();

      const id = addSuggestion({
        type: "insert",
        from: 0,
        to: 5,
      });

      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id);
    });

    it("dispatches ai-suggestion:added event", () => {
      const handler = vi.fn();
      window.addEventListener("ai-suggestion:added", handler);

      const { addSuggestion } = useAiSuggestionStore.getState();
      addSuggestion({ type: "insert", from: 0, to: 5 });

      expect(handler).toHaveBeenCalledTimes(1);

      window.removeEventListener("ai-suggestion:added", handler);
    });
  });

  describe("acceptSuggestion", () => {
    it("removes suggestion from store", () => {
      const { addSuggestion, acceptSuggestion } = useAiSuggestionStore.getState();

      const id = addSuggestion({ type: "insert", from: 0, to: 5 });
      expect(useAiSuggestionStore.getState().suggestions.size).toBe(1);

      acceptSuggestion(id);
      expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    });

    it("dispatches ai-suggestion:accept event", () => {
      const handler = vi.fn();
      window.addEventListener("ai-suggestion:accept", handler);

      const { addSuggestion, acceptSuggestion } = useAiSuggestionStore.getState();
      const id = addSuggestion({ type: "insert", from: 0, to: 5 });
      acceptSuggestion(id);

      expect(handler).toHaveBeenCalledTimes(1);

      window.removeEventListener("ai-suggestion:accept", handler);
    });

    it("updates focus to next suggestion", () => {
      const { addSuggestion, acceptSuggestion } = useAiSuggestionStore.getState();

      const id1 = addSuggestion({ type: "insert", from: 0, to: 5 });
      const id2 = addSuggestion({ type: "insert", from: 10, to: 15 });

      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);

      acceptSuggestion(id1);
      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id2);
    });
  });

  describe("rejectSuggestion", () => {
    it("removes suggestion from store", () => {
      const { addSuggestion, rejectSuggestion } = useAiSuggestionStore.getState();

      const id = addSuggestion({ type: "insert", from: 0, to: 5 });
      rejectSuggestion(id);

      expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    });

    it("dispatches ai-suggestion:reject event", () => {
      const handler = vi.fn();
      window.addEventListener("ai-suggestion:reject", handler);

      const { addSuggestion, rejectSuggestion } = useAiSuggestionStore.getState();
      const id = addSuggestion({ type: "insert", from: 0, to: 5 });
      rejectSuggestion(id);

      expect(handler).toHaveBeenCalledTimes(1);

      window.removeEventListener("ai-suggestion:reject", handler);
    });
  });

  describe("acceptAll / rejectAll", () => {
    it("acceptAll removes all suggestions", () => {
      const { addSuggestion, acceptAll } = useAiSuggestionStore.getState();

      addSuggestion({ type: "insert", from: 0, to: 5 });
      addSuggestion({ type: "insert", from: 10, to: 15 });
      addSuggestion({ type: "insert", from: 20, to: 25 });

      expect(useAiSuggestionStore.getState().suggestions.size).toBe(3);

      acceptAll();
      expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    });

    it("rejectAll removes all suggestions", () => {
      const { addSuggestion, rejectAll } = useAiSuggestionStore.getState();

      addSuggestion({ type: "insert", from: 0, to: 5 });
      addSuggestion({ type: "insert", from: 10, to: 15 });

      rejectAll();
      expect(useAiSuggestionStore.getState().suggestions.size).toBe(0);
    });
  });

  describe("navigation", () => {
    it("navigateNext cycles through suggestions", () => {
      const { addSuggestion, navigateNext } = useAiSuggestionStore.getState();

      const id1 = addSuggestion({ type: "insert", from: 0, to: 5 });
      const id2 = addSuggestion({ type: "insert", from: 10, to: 15 });
      const id3 = addSuggestion({ type: "insert", from: 20, to: 25 });

      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);

      navigateNext();
      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id2);

      navigateNext();
      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id3);

      // Wrap around
      navigateNext();
      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);
    });

    it("navigatePrevious cycles through suggestions", () => {
      const { addSuggestion, navigatePrevious } = useAiSuggestionStore.getState();

      const id1 = addSuggestion({ type: "insert", from: 0, to: 5 });
      const id2 = addSuggestion({ type: "insert", from: 10, to: 15 });
      addSuggestion({ type: "insert", from: 20, to: 25 });

      // Wrap around from first to last
      navigatePrevious();
      // After adding 3, focus is on id1. navigatePrevious goes to last (id3)
      const state = useAiSuggestionStore.getState();
      expect(state.focusedSuggestionId).not.toBe(id1);
      expect(state.focusedSuggestionId).not.toBe(id2);
    });
  });

  describe("getSortedSuggestions", () => {
    it("returns suggestions sorted by from position", () => {
      const { addSuggestion, getSortedSuggestions } = useAiSuggestionStore.getState();

      addSuggestion({ type: "insert", from: 20, to: 25 });
      addSuggestion({ type: "insert", from: 5, to: 10 });
      addSuggestion({ type: "insert", from: 50, to: 55 });

      const sorted = getSortedSuggestions();
      expect(sorted[0].from).toBe(5);
      expect(sorted[1].from).toBe(20);
      expect(sorted[2].from).toBe(50);
    });
  });

  describe("focusSuggestion", () => {
    it("sets focusedSuggestionId", () => {
      const { addSuggestion, focusSuggestion } = useAiSuggestionStore.getState();

      const id1 = addSuggestion({ type: "insert", from: 0, to: 5 });
      const id2 = addSuggestion({ type: "insert", from: 10, to: 15 });

      focusSuggestion(id2);
      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id2);

      focusSuggestion(id1);
      expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);
    });

    it("dispatches ai-suggestion:focus-changed event", () => {
      const handler = vi.fn();
      window.addEventListener("ai-suggestion:focus-changed", handler);

      const { addSuggestion, focusSuggestion } = useAiSuggestionStore.getState();
      const id = addSuggestion({ type: "insert", from: 0, to: 5 });

      focusSuggestion(id);
      // One from addSuggestion auto-focus, potentially one from explicit focus
      expect(handler).toHaveBeenCalled();

      window.removeEventListener("ai-suggestion:focus-changed", handler);
    });
  });

  describe("clearAll", () => {
    it("removes all suggestions and resets focus", () => {
      const { addSuggestion, clearAll } = useAiSuggestionStore.getState();

      addSuggestion({ type: "insert", from: 0, to: 5 });
      addSuggestion({ type: "insert", from: 10, to: 15 });

      clearAll();

      const state = useAiSuggestionStore.getState();
      expect(state.suggestions.size).toBe(0);
      expect(state.focusedSuggestionId).toBeNull();
    });
  });
});
