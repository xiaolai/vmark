/**
 * Tab Escape from Inline Code Tests (Issue #58 Problem 4)
 *
 * Verifies that Tab escapes from inline code mark when cursor
 * is at the end of the mark.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { canTabEscape, getMarkEndPos } from "../tabEscape";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
  marks: {
    code: {
      excludes: "_",
      parseDOM: [{ tag: "code" }],
      toDOM() {
        return ["code", 0];
      },
    },
    bold: {
      parseDOM: [{ tag: "strong" }],
      toDOM() {
        return ["strong", 0];
      },
    },
    link: {
      attrs: { href: {} },
      parseDOM: [{ tag: "a[href]" }],
      toDOM(mark) {
        return ["a", { href: mark.attrs.href }, 0];
      },
    },
  },
});

function createStateWithCodeMark(
  before: string,
  code: string,
  after: string,
  cursorInCode?: number
): EditorState {
  const codeMark = schema.marks.code.create();
  const children = [];
  if (before) children.push(schema.text(before));
  if (code) children.push(schema.text(code, [codeMark]));
  if (after) children.push(schema.text(after));

  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, children),
  ]);
  let state = EditorState.create({ doc });

  if (cursorInCode != null) {
    const pos = 1 + before.length + cursorInCode;
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos))
    );
  }
  return state;
}

describe("getMarkEndPos with code mark", () => {
  it("returns end position when cursor is inside code mark", () => {
    // "Hello " + ["this" with code mark] + " world"
    // Cursor at position 9 (inside "this", after "th")
    const state = createStateWithCodeMark("Hello ", "this", " world", 2);
    const endPos = getMarkEndPos(state);

    // End of "this" is at position 1 + 6 + 4 = 11
    expect(endPos).toBe(11);
  });

  it("returns end position when cursor is at the end of code mark", () => {
    // "Hello " + ["this" with code mark] + " world"
    // Cursor at position 11 (right at end of "this")
    const state = createStateWithCodeMark("Hello ", "this", " world", 4);

    // The code mark should still be active at this position (inclusive)
    // getMarkEndPos should still return the end position
    const endPos = getMarkEndPos(state);
    expect(endPos).toBe(11);
  });
});

describe("canTabEscape with code mark", () => {
  it("returns escape result when cursor is inside code mark", () => {
    const state = createStateWithCodeMark("Hello ", "this", " world", 2);
    const result = canTabEscape(state);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "mark");
    expect(result).toHaveProperty("targetPos", 11);
  });

  it("returns escape result when cursor is at end of code mark", () => {
    // Cursor at the very end of the code-marked text
    const state = createStateWithCodeMark("Hello ", "this", " world", 4);
    const result = canTabEscape(state);

    // Should still return an escape result (to clear storedMarks)
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "mark");
    expect(result).toHaveProperty("targetPos", 11);
  });

  it("returns null when cursor is outside code mark", () => {
    const state = createStateWithCodeMark("Hello ", "this", " world");
    // Default cursor at start of doc
    const result = canTabEscape(state);
    expect(result).toBeNull();
  });

  it("returns escape result for code mark at end of paragraph", () => {
    // "Hello " + ["this" with code mark] (no text after)
    const state = createStateWithCodeMark("Hello ", "this", "", 4);
    const result = canTabEscape(state);

    // Should return escape result even at end of paragraph
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type", "mark");
  });
});
