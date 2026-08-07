// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { useBlockMathEditingStore } from "../blockMathEditingStore";

beforeEach(() => {
  useBlockMathEditingStore.setState({
    editingPos: null,
    originalContent: null,
  });
});

describe("blockMathEditingStore", () => {
  describe("startEditing", () => {
    it("sets editing position and original content", () => {
      useBlockMathEditingStore.getState().startEditing(42, "x^2 + y^2");
      expect(useBlockMathEditingStore.getState().editingPos).toBe(42);
      expect(useBlockMathEditingStore.getState().originalContent).toBe("x^2 + y^2");
    });

    it("replaces previous editing state", () => {
      useBlockMathEditingStore.getState().startEditing(10, "old");
      useBlockMathEditingStore.getState().startEditing(20, "new");
      expect(useBlockMathEditingStore.getState().editingPos).toBe(20);
      expect(useBlockMathEditingStore.getState().originalContent).toBe("new");
    });

    it("handles empty content", () => {
      useBlockMathEditingStore.getState().startEditing(0, "");
      expect(useBlockMathEditingStore.getState().originalContent).toBe("");
    });
  });

  describe("exitEditing", () => {
    it("resets to initial state", () => {
      useBlockMathEditingStore.getState().startEditing(42, "content");
      useBlockMathEditingStore.getState().exitEditing();
      expect(useBlockMathEditingStore.getState().editingPos).toBeNull();
      expect(useBlockMathEditingStore.getState().originalContent).toBeNull();
    });

    it("is safe to call when not editing", () => {
      useBlockMathEditingStore.getState().exitEditing();
      expect(useBlockMathEditingStore.getState().editingPos).toBeNull();
    });
  });

  describe("isEditingAt", () => {
    it("returns true for matching position", () => {
      useBlockMathEditingStore.getState().startEditing(42, "content");
      expect(useBlockMathEditingStore.getState().isEditingAt(42)).toBe(true);
    });

    it("returns false for non-matching position", () => {
      useBlockMathEditingStore.getState().startEditing(42, "content");
      expect(useBlockMathEditingStore.getState().isEditingAt(99)).toBe(false);
    });

    it("returns false when nothing is being edited", () => {
      expect(useBlockMathEditingStore.getState().isEditingAt(0)).toBe(false);
    });
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("blockMathEditingStore — T09 revert contract pins", () => {
  const initialData = { editingPos: null, originalContent: null };

  function dataOf(s: ReturnType<typeof useBlockMathEditingStore.getState>) {
    const { editingPos, originalContent } = s;
    return { editingPos, originalContent };
  }

  it("no leak across sessions: edit A → exit → edit B shows only B", () => {
    useBlockMathEditingStore.getState().startEditing(1, "A");
    useBlockMathEditingStore.getState().exitEditing();
    useBlockMathEditingStore.getState().startEditing(2, "B");
    expect(dataOf(useBlockMathEditingStore.getState())).toEqual({
      editingPos: 2,
      originalContent: "B",
    });
  });

  it("rapid start/exit x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useBlockMathEditingStore.getState().startEditing(i, `c${i}`);
      useBlockMathEditingStore.getState().exitEditing();
    }
    expect(dataOf(useBlockMathEditingStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useBlockMathEditingStore.getState().startEditing(42, "mutated");
      expect(dataOf(useBlockMathEditingStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useBlockMathEditingStore.getState().startEditing(42, "open");
      useBlockMathEditingStore.setState(useBlockMathEditingStore.getInitialState());
      expect(dataOf(useBlockMathEditingStore.getState())).toEqual(initialData);
    });
  });
});
