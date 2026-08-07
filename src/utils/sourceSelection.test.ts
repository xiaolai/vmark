// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  getSourceBlockRange,
  getSourceExpandedRange,
  getSourceLineRange,
  getSourceWordRange,
  getSourceSelectionRange,
  _getSourceDocRange,
} from "./sourceSelection";

function createState(doc: string, from: number, to = from) {
  return EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
  });
}

describe("sourceSelection", () => {
  it("finds word range at cursor", () => {
    const state = createState("Hello world", 1);
    const range = getSourceWordRange(state, 1);
    expect(range).toEqual({ from: 0, to: 5 });
  });

  it("finds line range at cursor", () => {
    const doc = "one\ntwo\nthree";
    const state = createState(doc, 5);
    const line = state.doc.line(2);
    const range = getSourceLineRange(state, 5);
    expect(range).toEqual({ from: line.from, to: line.to });
  });

  it("finds block range between blank lines", () => {
    const doc = "one\ntwo\n\nthree\nfour\n\nfive";
    const state = createState(doc, 10);
    const lineThree = state.doc.line(4);
    const lineFour = state.doc.line(5);
    const range = getSourceBlockRange(state, lineThree.from, lineThree.from + 1);
    expect(range).toEqual({ from: lineThree.from, to: lineFour.to });
  });

  it("expands selection from word to line to block to document", () => {
    const doc = "alpha beta\ngamma\n\nomega";
    const wordState = createState(doc, 1);
    const wordRange = getSourceExpandedRange(wordState, 1, 1);
    expect(wordRange).toEqual({ from: 0, to: 5 });

    const lineState = createState(doc, wordRange?.from ?? 0, wordRange?.to ?? 0);
    const lineRange = getSourceExpandedRange(lineState, lineState.selection.main.from, lineState.selection.main.to);
    const expectedLine = lineState.doc.line(1);
    expect(lineRange).toEqual({ from: expectedLine.from, to: expectedLine.to });

    const blockState = createState(doc, lineRange?.from ?? 0, lineRange?.to ?? 0);
    const blockRange = getSourceExpandedRange(blockState, blockState.selection.main.from, blockState.selection.main.to);
    const expectedBlockEnd = blockState.doc.line(2).to;
    expect(blockRange).toEqual({ from: expectedLine.from, to: expectedBlockEnd });

    const docState = createState(doc, blockRange?.from ?? 0, blockRange?.to ?? 0);
    const docRange = getSourceExpandedRange(docState, docState.selection.main.from, docState.selection.main.to);
    expect(docRange).toEqual({ from: 0, to: docState.doc.length });

    const fullState = createState(doc, 0, docState.doc.length);
    const fullRange = getSourceExpandedRange(fullState, 0, fullState.doc.length);
    expect(fullRange).toBeNull();
  });

  it("normalizes reversed range (from > to)", () => {
    const doc = "one\ntwo\nthree";
    const state = createState(doc, 10);
    // Pass reversed range to getSourceBlockRange to exercise normalizeRange swap
    const range = getSourceBlockRange(state, 10, 5);
    expect(range.from).toBeLessThanOrEqual(range.to);
  });

  it("expands block range reaching end of document", () => {
    // Block at the very end with no trailing blank line
    const doc = "one\n\ntwo\nthree";
    const state = createState(doc, 10);
    const range = getSourceBlockRange(state, 5, 10);
    // Should expand to include "three" since no blank line after it
    const lastLine = state.doc.line(state.doc.lines);
    expect(range.to).toBe(lastLine.to);
  });

  it("returns null for getSourceWordRange at space position", () => {
    // Position 5 is at the space between "Hello" and "world"
    // CodeMirror's wordAt(5) may still return "Hello" since 5 is at end of word.
    // Position inside the space char returns null for wordAt.
    const state = createState("Hello  world", 6);
    const range = getSourceWordRange(state, 6);
    // Position 6 is inside double-space, not at a word
    expect(range).toBeNull();
  });

  describe("getSourceSelectionRange", () => {
    it("returns the main selection range normalized", () => {
      const state = createState("Hello world", 3, 8);
      const range = getSourceSelectionRange(state);
      expect(range).toEqual({ from: 3, to: 8 });
    });

    it("normalizes reversed selection", () => {
      // EditorSelection.range with anchor > head
      const state = EditorState.create({
        doc: "Hello world",
        selection: EditorSelection.single(8, 3),
      });
      const range = getSourceSelectionRange(state);
      expect(range).toEqual({ from: 3, to: 8 });
    });
  });

  it("expands from cursor at word start (word.from === cursor, evaluates word.to branch)", () => {
    // Cursor at position 0 = start of "alpha". word.from (0) === normalized.from (0),
    // so the || short-circuit doesn't fire; word.to (5) !== normalized.to (0) is checked.
    const state = createState("alpha beta", 0);
    const range = getSourceExpandedRange(state, 0, 0);
    expect(range).toEqual({ from: 0, to: 5 });
  });

  describe("_getSourceDocRange", () => {
    it("returns full document range", () => {
      const doc = "Hello world";
      const state = createState(doc, 0);
      const range = _getSourceDocRange(state.doc);
      expect(range).toEqual({ from: 0, to: doc.length });
    });

    it("returns {0,0} for empty document", () => {
      const state = createState("", 0);
      const range = _getSourceDocRange(state.doc);
      expect(range).toEqual({ from: 0, to: 0 });
    });
  });
});
