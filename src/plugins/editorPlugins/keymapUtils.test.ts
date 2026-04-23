/**
 * Tests for keymapUtils — toProseMirrorKey, bindIfKey, wrapWithMultiSelectionGuard,
 * escapeMarkBoundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before import
vi.mock("@/utils/imeGuard", () => ({
  guardProseMirrorCommand: vi.fn((cmd) => cmd),
}));

vi.mock("@/plugins/toolbarActions/multiSelectionPolicy", () => ({
  canRunActionInMultiSelection: vi.fn(() => true),
}));

vi.mock("@/plugins/toolbarActions/multiSelectionContext", () => ({
  getWysiwygMultiSelectionContext: vi.fn(() => ({ count: 1, allSameBlock: true })),
}));

vi.mock("@/plugins/syntaxReveal/marks", () => ({
  findAnyMarkRangeAtCursor: vi.fn(() => null),
}));

import {
  toProseMirrorKey,
  bindIfKey,
  wrapWithMultiSelectionGuard,
  escapeMarkBoundary,
  collapseNonEmptySelection,
} from "./keymapUtils";
import { canRunActionInMultiSelection } from "@/plugins/toolbarActions/multiSelectionPolicy";
import { findAnyMarkRangeAtCursor } from "@/plugins/syntaxReveal/marks";
import type { Command } from "@tiptap/pm/state";

describe("toProseMirrorKey", () => {
  it("converts Up to ArrowUp", () => {
    expect(toProseMirrorKey("Alt-Up")).toBe("Alt-ArrowUp");
  });

  it("converts Down to ArrowDown", () => {
    expect(toProseMirrorKey("Mod-Shift-Down")).toBe("Mod-Shift-ArrowDown");
  });

  it("converts Left to ArrowLeft", () => {
    expect(toProseMirrorKey("Left")).toBe("ArrowLeft");
  });

  it("converts Right to ArrowRight", () => {
    expect(toProseMirrorKey("Right")).toBe("ArrowRight");
  });

  it("leaves non-arrow keys unchanged", () => {
    expect(toProseMirrorKey("Mod-b")).toBe("Mod-b");
  });

  it("leaves Escape unchanged", () => {
    expect(toProseMirrorKey("Escape")).toBe("Escape");
  });

  it("leaves F-keys unchanged", () => {
    expect(toProseMirrorKey("F5")).toBe("F5");
  });

  it("converts multiple arrow keys in the same string", () => {
    // Edge case: shouldn't happen in practice, but tests the regex
    expect(toProseMirrorKey("Up-Down")).toBe("ArrowUp-ArrowDown");
  });

  it("does not convert 'Up' inside longer words", () => {
    // The \\b word boundary should prevent partial matches
    expect(toProseMirrorKey("Mod-Shift-u")).toBe("Mod-Shift-u");
  });

  it("handles empty string", () => {
    expect(toProseMirrorKey("")).toBe("");
  });

  it("converts standalone Up/Down/Left/Right", () => {
    expect(toProseMirrorKey("Up")).toBe("ArrowUp");
    expect(toProseMirrorKey("Down")).toBe("ArrowDown");
    expect(toProseMirrorKey("Left")).toBe("ArrowLeft");
    expect(toProseMirrorKey("Right")).toBe("ArrowRight");
  });
});

describe("bindIfKey", () => {
  it("adds a command to bindings when key is non-empty", () => {
    const bindings: Record<string, Command> = {};
    const command: Command = () => true;
    bindIfKey(bindings, "Mod-b", command);
    expect(bindings["Mod-b"]).toBeTypeOf("function");
  });

  it("does not add to bindings when key is empty string", () => {
    const bindings: Record<string, Command> = {};
    const command: Command = () => true;
    bindIfKey(bindings, "", command);
    expect(Object.keys(bindings)).toHaveLength(0);
  });

  it("converts arrow key format", () => {
    const bindings: Record<string, Command> = {};
    const command: Command = () => true;
    bindIfKey(bindings, "Alt-Up", command);
    expect(bindings["Alt-ArrowUp"]).toBeTypeOf("function");
    expect(bindings["Alt-Up"]).toBeUndefined();
  });

  it("overwrites existing binding for same key", () => {
    const bindings: Record<string, Command> = {};
    const command1: Command = () => true;
    const command2: Command = () => false;
    bindIfKey(bindings, "Mod-b", command1);
    bindIfKey(bindings, "Mod-b", command2);
    // The second command should overwrite the first
    expect(bindings["Mod-b"]).toBeDefined();
  });
});

describe("wrapWithMultiSelectionGuard", () => {
  beforeEach(() => {
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(true);
  });

  it("returns false when view is null", () => {
    const inner: Command = () => true;
    const guarded = wrapWithMultiSelectionGuard("bold", inner);
    expect(guarded({} as never, undefined, undefined)).toBe(false);
  });

  it("calls inner command when multi-selection policy allows", () => {
    const inner = vi.fn(() => true) as unknown as Command;
    const guarded = wrapWithMultiSelectionGuard("bold", inner);
    const mockView = { state: { selection: {} } } as never;
    const mockState = {} as never;

    guarded(mockState, undefined, mockView);
    expect(inner).toHaveBeenCalledWith(mockState, undefined, mockView);
  });

  it("returns false when multi-selection policy denies", () => {
    vi.mocked(canRunActionInMultiSelection).mockReturnValue(false);
    const inner = vi.fn(() => true) as unknown as Command;
    const guarded = wrapWithMultiSelectionGuard("heading", inner);
    const mockView = { state: { selection: {} } } as never;

    const result = guarded({} as never, undefined, mockView);
    expect(result).toBe(false);
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes through the return value of the inner command", () => {
    const inner = vi.fn(() => false) as unknown as Command;
    const guarded = wrapWithMultiSelectionGuard("italic", inner);
    const mockView = { state: { selection: {} } } as never;

    const result = guarded({} as never, undefined, mockView);
    expect(result).toBe(false);
  });
});

describe("escapeMarkBoundary", () => {
  it("returns false when selection is not empty", () => {
    const view = {
      state: {
        selection: { $from: { pos: 1 }, empty: false },
      },
      dispatch: vi.fn(),
    } as never;

    expect(escapeMarkBoundary(view)).toBe(false);
  });

  it("returns false when no mark range and no stored marks", () => {
    const view = {
      state: {
        selection: { $from: { pos: 1 }, empty: true },
        storedMarks: null,
      },
      dispatch: vi.fn(),
    } as never;

    expect(escapeMarkBoundary(view)).toBe(false);
  });

  it("returns false when no mark range and stored marks is empty array", () => {
    const view = {
      state: {
        selection: { $from: { pos: 1 }, empty: true },
        storedMarks: [],
      },
      dispatch: vi.fn(),
    } as never;

    expect(escapeMarkBoundary(view)).toBe(false);
  });

  it("clears stored marks when no mark range but stored marks exist", () => {
    const dispatchFn = vi.fn();
    const mockTr = { setStoredMarks: vi.fn().mockReturnThis() };
    const view = {
      state: {
        selection: { $from: { pos: 1 }, empty: true },
        storedMarks: [{ type: "bold" }],
        tr: mockTr,
      },
      dispatch: dispatchFn,
    } as never;

    const result = escapeMarkBoundary(view);
    expect(result).toBe(true);
    expect(mockTr.setStoredMarks).toHaveBeenCalledWith([]);
    expect(dispatchFn).toHaveBeenCalledWith(mockTr);
  });

  it("clears stored marks when cursor is at mark end (markTo)", () => {
    vi.mocked(findAnyMarkRangeAtCursor).mockReturnValueOnce({ from: 2, to: 5 });

    const dispatchFn = vi.fn();
    const mockTr = { setStoredMarks: vi.fn().mockReturnThis() };
    const view = {
      state: {
        selection: { $from: { pos: 5 }, empty: true },
        storedMarks: null,
        tr: mockTr,
      },
      dispatch: dispatchFn,
    } as never;

    const result = escapeMarkBoundary(view);
    expect(result).toBe(true);
    expect(mockTr.setStoredMarks).toHaveBeenCalledWith([]);
  });

  it("handles cursor at markFrom with markFrom > 1 using real ProseMirror state", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema } = require("@tiptap/pm/model");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EditorState, TextSelection } = require("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
      marks: {
        bold: {},
      },
    });

    const boldMark = testSchema.marks.bold.create();
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [
        testSchema.text("ab", []),
        testSchema.text("cde", [boldMark]),
      ]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });
    const stateAtMark = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3))
    );

    // Mark range starts at pos 3
    vi.mocked(findAnyMarkRangeAtCursor).mockReturnValueOnce({ from: 3, to: 6 });

    const dispatchFn = vi.fn();
    const view = {
      state: stateAtMark,
      dispatch: dispatchFn,
    } as never;

    const result = escapeMarkBoundary(view);
    expect(result).toBe(true);
    expect(dispatchFn).toHaveBeenCalled();
  });

  it("clears stored marks when at markFrom and markFrom <= 1", () => {
    vi.mocked(findAnyMarkRangeAtCursor).mockReturnValueOnce({ from: 1, to: 5 });

    const dispatchFn = vi.fn();
    const mockTr = { setStoredMarks: vi.fn().mockReturnThis() };
    const view = {
      state: {
        selection: { $from: { pos: 1 }, empty: true },
        storedMarks: null,
        tr: mockTr,
      },
      dispatch: dispatchFn,
    } as never;

    const result = escapeMarkBoundary(view);
    expect(result).toBe(true);
    expect(mockTr.setStoredMarks).toHaveBeenCalledWith([]);
    expect(dispatchFn).toHaveBeenCalledWith(mockTr);
  });

  it("moves cursor to mark end when inside mark range using real state", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema } = require("@tiptap/pm/model");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EditorState, TextSelection } = require("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
      marks: {
        bold: {},
      },
    });

    const boldMark = testSchema.marks.bold.create();
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [
        testSchema.text("hello", [boldMark]),
        testSchema.text(" world"),
      ]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });
    // Cursor inside the bold mark range but not at from or to
    const stateInMark = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3))
    );

    vi.mocked(findAnyMarkRangeAtCursor).mockReturnValueOnce({ from: 1, to: 6 });

    const dispatchFn = vi.fn();
    const view = {
      state: stateInMark,
      dispatch: dispatchFn,
    } as never;

    const result = escapeMarkBoundary(view);
    expect(result).toBe(true);
    expect(dispatchFn).toHaveBeenCalled();
  });
});

describe("collapseNonEmptySelection", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Schema } = require("@tiptap/pm/model");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EditorState, TextSelection, AllSelection, NodeSelection } = require("@tiptap/pm/state");

  const testSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { inline: true, group: "inline" },
      horizontal_rule: { group: "block", atom: true },
    },
  });

  function makeState(pos: number, head?: number) {
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
      testSchema.node("paragraph", null, [testSchema.text("second line")]),
    ]);
    const base = EditorState.create({ doc, schema: testSchema });
    return base.apply(
      base.tr.setSelection(TextSelection.create(base.doc, pos, head ?? pos))
    );
  }

  it("returns false when selection is already collapsed", () => {
    const view = { state: makeState(3), dispatch: vi.fn() } as never;
    expect(collapseNonEmptySelection(view)).toBe(false);
    expect((view as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();
  });

  it("collapses a TextSelection spanning multiple positions to head", () => {
    const state = makeState(2, 8);
    const dispatchFn = vi.fn();
    const view = { state, dispatch: dispatchFn } as never;

    const result = collapseNonEmptySelection(view);
    expect(result).toBe(true);
    expect(dispatchFn).toHaveBeenCalledTimes(1);
    const tr = dispatchFn.mock.calls[0][0];
    const newSel = tr.selection;
    expect(newSel.empty).toBe(true);
    // Head is the "to" endpoint when anchor < head; cursor lands at head.
    expect(newSel.from).toBe(8);
    expect(newSel.to).toBe(8);
  });

  it("collapses backwards selection to head (anchor > head)", () => {
    const state = makeState(8, 2);
    const dispatchFn = vi.fn();
    const view = { state, dispatch: dispatchFn } as never;

    const result = collapseNonEmptySelection(view);
    expect(result).toBe(true);
    const tr = dispatchFn.mock.calls[0][0];
    expect(tr.selection.empty).toBe(true);
    expect(tr.selection.from).toBe(2);
  });

  it("collapses an AllSelection to its head", () => {
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("abc")]),
    ]);
    const base = EditorState.create({ doc, schema: testSchema });
    const state = base.apply(base.tr.setSelection(new AllSelection(base.doc)));
    const dispatchFn = vi.fn();
    const view = { state, dispatch: dispatchFn } as never;

    const result = collapseNonEmptySelection(view);
    expect(result).toBe(true);
    const tr = dispatchFn.mock.calls[0][0];
    expect(tr.selection.empty).toBe(true);
  });

  it("collapses a NodeSelection (atom block) to a cursor position", () => {
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("a")]),
      testSchema.node("horizontal_rule"),
      testSchema.node("paragraph", null, [testSchema.text("b")]),
    ]);
    const base = EditorState.create({ doc, schema: testSchema });
    // The horizontal_rule node starts at position 3 in this doc structure
    const state = base.apply(base.tr.setSelection(NodeSelection.create(base.doc, 3)));
    expect(state.selection.empty).toBe(false);
    const dispatchFn = vi.fn();
    const view = { state, dispatch: dispatchFn } as never;

    const result = collapseNonEmptySelection(view);
    expect(result).toBe(true);
    const tr = dispatchFn.mock.calls[0][0];
    expect(tr.selection.empty).toBe(true);
  });

  it("returns false when selection has multiple ranges (multi-cursor)", () => {
    // Simulate a MultiSelection-shaped selection: ranges.length > 1 and empty === false
    const state = makeState(2, 5);
    const fakeMultiSelection = {
      ...state.selection,
      empty: false,
      ranges: [
        { $from: state.doc.resolve(2), $to: state.doc.resolve(5) },
        { $from: state.doc.resolve(6), $to: state.doc.resolve(8) },
      ],
    };
    const view = {
      state: { ...state, selection: fakeMultiSelection },
      dispatch: vi.fn(),
    } as never;

    expect(collapseNonEmptySelection(view)).toBe(false);
    expect((view as { dispatch: ReturnType<typeof vi.fn> }).dispatch).not.toHaveBeenCalled();
  });
});
