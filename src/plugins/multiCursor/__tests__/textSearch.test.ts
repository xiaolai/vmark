// @vitest-environment node
/**
 * Tests for textSearch module
 *
 * Covers getSelectionText, getWordAtCursor, and findAllOccurrences
 * with edge cases for bounds, empty input, and non-text nodes.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { getSelectionText, getWordAtCursor, findAllOccurrences } from "../textSearch";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

function createState(text: string, selection?: { from: number; to: number }) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  const state = EditorState.create({ doc, schema });
  if (selection) {
    return state.apply(
      state.tr.setSelection(TextSelection.create(doc, selection.from, selection.to))
    );
  }
  return state;
}

describe("getSelectionText", () => {
  it("returns selected text", () => {
    const state = createState("hello world", { from: 1, to: 6 });
    expect(getSelectionText(state)).toBe("hello");
  });

  it("returns empty string for collapsed selection", () => {
    const state = createState("hello world", { from: 3, to: 3 });
    expect(getSelectionText(state)).toBe("");
  });
});

describe("getWordAtCursor", () => {
  it("returns null for non-empty selection", () => {
    const state = createState("hello world", { from: 1, to: 6 });
    expect(getWordAtCursor(state)).toBeNull();
  });

  it("returns word boundaries for cursor in word", () => {
    const state = createState("hello world", { from: 3, to: 3 });
    const result = getWordAtCursor(state);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("hello");
    expect(result!.from).toBe(1);
    expect(result!.to).toBe(6);
  });

  it("returns null when cursor is at space", () => {
    const state = createState("hello world", { from: 6, to: 6 });
    const result = getWordAtCursor(state);
    expect(result).toBeNull();
  });
});

describe("findAllOccurrences", () => {
  it("returns empty array for empty searchText", () => {
    const state = createState("hello world");
    expect(findAllOccurrences(state, "")).toEqual([]);
  });

  it("finds all occurrences in document", () => {
    const state = createState("hello hello hello");
    const results = findAllOccurrences(state, "hello");
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ from: 1, to: 6 });
    expect(results[1]).toEqual({ from: 7, to: 12 });
    expect(results[2]).toEqual({ from: 13, to: 18 });
  });

  it("respects bounds parameter", () => {
    const state = createState("hello hello hello");
    const results = findAllOccurrences(state, "hello", { from: 5, to: 14 });
    // Only the second "hello" (7-12) should be fully within bounds
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ from: 7, to: 12 });
  });

  it("returns results sorted by position", () => {
    const state = createState("aa bb aa");
    const results = findAllOccurrences(state, "aa");
    expect(results).toHaveLength(2);
    expect(results[0].from).toBeLessThan(results[1].from);
  });

  it("finds overlapping occurrences", () => {
    const state = createState("aaa");
    const results = findAllOccurrences(state, "aa");
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ from: 1, to: 3 });
    expect(results[1]).toEqual({ from: 2, to: 4 });
  });
});
