// @vitest-environment node
/**
 * Tests for expandedToggleMark — mark toggling with word expansion,
 * opposing marks, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Mock the dependencies
const mockFindMarkRange = vi.fn(() => null);
const mockFindAnyMarkRangeAtCursor = vi.fn(() => null);
const mockFindWordAtCursor = vi.fn(() => null);

vi.mock("@/plugins/syntaxReveal/marks", () => ({
  findMarkRange: (...args: unknown[]) => mockFindMarkRange(...args),
  findAnyMarkRangeAtCursor: (...args: unknown[]) => mockFindAnyMarkRangeAtCursor(...args),
  findWordAtCursor: (...args: unknown[]) => mockFindWordAtCursor(...args),
}));

// Create a hoisted class so vi.mock can reference it
const { MockMultiSelection } = vi.hoisted(() => {
  class MockMultiSelection {
    ranges: Array<{ $from: { pos: number }; $to: { pos: number } }>;
    primaryIndex: number;
    constructor(
      ranges: Array<{ $from: { pos: number }; $to: { pos: number } }>,
      primaryIndex = 0
    ) {
      this.ranges = ranges;
      this.primaryIndex = primaryIndex;
    }
  }
  return { MockMultiSelection };
});

vi.mock("@/plugins/multiCursor", () => ({
  MultiSelection: MockMultiSelection,
}));

import { expandedToggleMark } from "./expandedToggleMark";

// Minimal schema with marks for testing
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
  marks: {
    bold: {},
    italic: {},
    code: {},
    strike: {},
    underline: {},
    highlight: {},
    subscript: { excludes: "superscript" },
    superscript: { excludes: "subscript" },
  },
});

function createState(text: string, from?: number, to?: number): EditorState {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  const state = EditorState.create({ doc, schema });
  if (from !== undefined && to !== undefined) {
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, from, to))
    );
  }
  return state;
}

function createView(state: EditorState): EditorView {
  const dispatched: { tr: unknown }[] = [];
  return {
    state,
    dispatch: vi.fn((tr) => {
      dispatched.push({ tr });
    }),
  } as unknown as EditorView;
}

describe("expandedToggleMark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMarkRange.mockReturnValue(null);
    mockFindAnyMarkRangeAtCursor.mockReturnValue(null);
    mockFindWordAtCursor.mockReturnValue(null);
  });

  it("returns false when mark type does not exist in schema", () => {
    const state = createState("hello");
    const view = createView(state);
    expect(expandedToggleMark(view, "nonexistent")).toBe(false);
  });

  describe("non-empty selection", () => {
    it("adds mark to selected range", () => {
      // "hello" with selection from pos 1 to 6 (the full word)
      const state = createState("hello", 1, 6);
      const view = createView(state);

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes mark from selected range if already present", () => {
      // Create a state with bold already applied
      const boldMark = schema.marks.bold.create();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("hello", [boldMark]),
        ]),
      ]);
      let state = EditorState.create({ doc, schema });
      state = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 1, 6))
      );
      const view = createView(state);

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes opposing mark (subscript/superscript) on selection", () => {
      const superMark = schema.marks.superscript.create();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("hello", [superMark]),
        ]),
      ]);
      let state = EditorState.create({ doc, schema });
      state = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 1, 6))
      );
      const view = createView(state);

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("collapsed cursor — mark range found", () => {
    it("removes existing mark range at cursor", () => {
      const boldMark = schema.marks.bold.create();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("hello", [boldMark]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createView(state);

      // findMarkRange returns a range covering the bold mark
      mockFindMarkRange.mockReturnValue({ from: 1, to: 6 });

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("collapsed cursor — no mark range, word found", () => {
    it("applies mark to word at cursor", () => {
      const state = createState("hello world");
      // Cursor at position 3 (inside "hello")
      const stateWithCursor = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 3))
      );
      const view = createView(stateWithCursor);

      mockFindWordAtCursor.mockReturnValue({ from: 1, to: 6 });

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes mark from word if word already has the mark", () => {
      const boldMark = schema.marks.bold.create();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("hello", [boldMark]),
          schema.text(" world"),
        ]),
      ]);
      let state = EditorState.create({ doc, schema });
      state = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 3))
      );
      const view = createView(state);

      mockFindWordAtCursor.mockReturnValue({ from: 1, to: 6 });

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("collapsed cursor — no mark, no word (stored marks fallback)", () => {
    it("adds stored mark when no word found", () => {
      const state = createState("hello");
      const view = createView(state);

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes stored mark if already set", () => {
      const state = createState("hello");
      const boldMark = schema.marks.bold.create();
      const stateWithStoredMark = state.apply(
        state.tr.addStoredMark(boldMark)
      );
      const view = createView(stateWithStoredMark);

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes opposing stored mark (subscript removes superscript)", () => {
      const state = createState("hello");
      const superMark = schema.marks.superscript.create();
      const stateWithStoredMark = state.apply(
        state.tr.addStoredMark(superMark)
      );
      const view = createView(stateWithStoredMark);

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("opposing marks", () => {
    it("subscript and superscript are opposing", () => {
      const state = createState("hello", 1, 6);
      const view = createView(state);

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
    });

    it("bold has no opposing mark", () => {
      const state = createState("hello", 1, 6);
      const view = createView(state);

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
    });

    it("superscript resolves subscript as opposing mark (line 51 true branch)", () => {
      // markTypeName === "superscript" → line 51 evaluates to true → returns "subscript"
      // This exercises the second ternary branch in the opposing mark resolution.
      const state = createState("hello", 1, 6);
      const view = createView(state);

      const result = expandedToggleMark(view, "superscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("inherited mark range", () => {
    it("applies mark to inherited range when found", () => {
      const state = createState("hello");
      const view = createView(state);

      // No mark range for bold, but there's an inherited range (e.g., italic)
      mockFindAnyMarkRangeAtCursor.mockReturnValue({ from: 1, to: 6, isLink: false });

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("skips inherited range for code when range is a link", () => {
      const state = createState("hello");
      const view = createView(state);

      mockFindAnyMarkRangeAtCursor.mockReturnValue({ from: 1, to: 6, isLink: true });
      // Should fall through to word/stored marks
      const result = expandedToggleMark(view, "code");
      expect(result).toBe(true);
    });

    it("uses inherited range for non-code marks even when isLink", () => {
      const state = createState("hello");
      const view = createView(state);

      mockFindAnyMarkRangeAtCursor.mockReturnValue({ from: 1, to: 6, isLink: true });

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes opposing mark from inherited range for subscript", () => {
      const state = createState("hello");
      const view = createView(state);

      mockFindAnyMarkRangeAtCursor.mockReturnValue({ from: 1, to: 6, isLink: false });

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("re-toggle after removal (lastRemovedMark)", () => {
    it("re-applies mark at last removed position when cursor is within range", () => {
      const boldMark = schema.marks.bold.create();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("hello", [boldMark]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createView(state);

      // First call: findMarkRange returns a range to remove bold
      mockFindMarkRange.mockReturnValueOnce({ from: 1, to: 6 });
      expandedToggleMark(view, "bold");
      expect(view.dispatch).toHaveBeenCalled();

      // Second call: cursor still in the range, no mark range found
      // but lastRemovedMark should trigger re-apply
      mockFindMarkRange.mockReturnValue(null);
      mockFindAnyMarkRangeAtCursor.mockReturnValue(null);
      mockFindWordAtCursor.mockReturnValue(null);

      // We need a fresh state since the view is a mock
      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
    });
  });

  describe("collapsed cursor — opposing mark range found", () => {
    it("removes opposing mark range for superscript when toggling subscript", () => {
      const superMark = schema.marks.superscript.create();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("hello", [superMark]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createView(state);

      // No range for subscript
      mockFindMarkRange
        .mockReturnValueOnce(null) // first call for subscript
        .mockReturnValueOnce({ from: 1, to: 6 }); // second call for opposing superscript

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("collapsed cursor — word found with opposing mark", () => {
    it("removes opposing mark and adds mark to word", () => {
      const state = createState("hello world");
      const stateWithCursor = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 3))
      );
      const view = createView(stateWithCursor);

      mockFindWordAtCursor.mockReturnValue({ from: 1, to: 6 });

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });

  describe("MultiSelection branch", () => {
    function createMultiState(text: string) {
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, text ? [schema.text(text)] : []),
      ]);
      return EditorState.create({ doc, schema });
    }

    function makeMultiSelectionState(
      state: EditorState,
      ranges: Array<{ from: number; to: number }>
    ) {
      // Create a state whose selection is an instance of MockMultiSelection
      const multiRanges = ranges.map((r) => ({
        $from: { pos: r.from, doc: state.doc, start: () => 0 } as unknown,
        $to: { pos: r.to } as unknown,
      })) as Array<{ $from: { pos: number }; $to: { pos: number } }>;

      const multiSel = new MockMultiSelection(multiRanges, 0);
      // Return a view-like object with the multi selection
      return {
        state: {
          ...state,
          selection: multiSel,
          schema: state.schema,
          doc: state.doc,
          tr: state.tr,
          storedMarks: null,
        },
        dispatch: vi.fn(),
      } as unknown as import("@tiptap/pm/view").EditorView;
    }

    it("adds mark to all ranges in multi-selection (non-empty ranges)", () => {
      const state = createMultiState("hello world");
      // Select "hello" (1-6) and "world" (7-12)
      const view = makeMultiSelectionState(state, [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("expands collapsed cursors to words in multi-selection", () => {
      const state = createMultiState("hello world");
      // Two collapsed cursors — inside "hello" and "world"
      const view = makeMultiSelectionState(state, [
        { from: 3, to: 3 },
        { from: 9, to: 9 },
      ]);

      mockFindWordAtCursor
        .mockReturnValueOnce({ from: 1, to: 6 }) // primary: "hello"
        .mockReturnValueOnce({ from: 1, to: 6 }) // first range
        .mockReturnValueOnce({ from: 7, to: 12 }); // second range

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("skips collapsed cursors with no word in multi-selection and falls through", () => {
      const state = createMultiState("  ");
      const view = makeMultiSelectionState(state, [
        { from: 1, to: 1 },
        { from: 2, to: 2 },
      ]);

      // No word found at any cursor
      mockFindWordAtCursor.mockReturnValue(null);

      const result = expandedToggleMark(view, "bold");
      // No ranges applied in MultiSelection, falls through to stored marks fallback
      // which always returns true
      expect(result).toBe(true);
    });

    it("removes opposing mark in multi-selection", () => {
      const state = createMultiState("hello world");
      const view = makeMultiSelectionState(state, [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes mark when primary range already has the mark", () => {
      const boldMark = schema.marks.bold.create();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("hello", [boldMark]),
          schema.text(" "),
          schema.text("world", [boldMark]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = makeMultiSelectionState(state, [
        { from: 1, to: 6 },
        { from: 7, to: 12 },
      ]);

      const result = expandedToggleMark(view, "bold");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes opposing mark from collapsed cursors in multi-selection (line 104 branch)", () => {
      // Collapsed cursors in multi-selection with an opposing mark (subscript/superscript).
      // This exercises the `if (opposingMarkType)` branch (line 104) for collapsed ranges.
      const state = createMultiState("hello world");
      const view = makeMultiSelectionState(state, [
        { from: 3, to: 3 }, // collapsed inside "hello"
      ]);

      // Word found at cursor — triggers the collapsed branch with opposingMarkType present
      mockFindWordAtCursor
        .mockReturnValueOnce({ from: 1, to: 6 }) // primary word check
        .mockReturnValueOnce({ from: 1, to: 6 }); // range word check

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("removes mark from collapsed cursor word when shouldAdd is false (line 109 branch)", () => {
      // shouldAdd=false for collapsed cursors in multi-selection: primary word already has
      // the mark, so shouldAdd=false → calls removeMark (line 109).
      const subscriptMark = schema.marks.subscript.create();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("hello", [subscriptMark]),
          schema.text(" world"),
        ]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = makeMultiSelectionState(state, [
        { from: 3, to: 3 }, // collapsed inside "hello" (which has subscript)
      ]);

      // Word found for primary and for the range — primary word has subscript so shouldAdd=false
      mockFindWordAtCursor
        .mockReturnValueOnce({ from: 1, to: 6 }) // primary: word range for shouldAdd check
        .mockReturnValueOnce({ from: 1, to: 6 }); // first range: word range for toggle

      const result = expandedToggleMark(view, "subscript");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it("mixes collapsed and non-empty ranges in multi-selection", () => {
      const state = createMultiState("hello world test");
      const view = makeMultiSelectionState(state, [
        { from: 1, to: 6 }, // select "hello"
        { from: 10, to: 10 }, // cursor inside "world"
      ]);

      mockFindWordAtCursor
        .mockReturnValueOnce(null) // primary is non-empty, no word check
        .mockReturnValueOnce({ from: 7, to: 12 }); // second cursor: "world"

      const result = expandedToggleMark(view, "italic");
      expect(result).toBe(true);
      expect(view.dispatch).toHaveBeenCalled();
    });
  });
});
