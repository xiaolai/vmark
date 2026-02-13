/**
 * Inline Code Boundary Tests (Issue #58 Problem 3)
 *
 * Verifies that cursor at the left boundary of inline code
 * gets storedMarks set to include the code mark.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { createInlineCodeBoundaryPlugin } from "../plugin";

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
  },
});

function createStateWithPlugin(
  before: string,
  code: string,
  after: string
): EditorState {
  const codeMark = schema.marks.code.create();
  const children = [];
  if (before) children.push(schema.text(before));
  if (code) children.push(schema.text(code, [codeMark]));
  if (after) children.push(schema.text(after));

  return EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, children),
    ]),
    plugins: [createInlineCodeBoundaryPlugin()],
  });
}

describe("inline code boundary plugin", () => {
  it("sets storedMarks with code mark when cursor is at left boundary", () => {
    // "Hello " + ["code" with code mark] + " world"
    const state = createStateWithPlugin("Hello ", "code", " world");

    // Move cursor to left boundary of code mark (position 7 = 1 + 6)
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 7));
    const newState = state.apply(tr);

    // The appendTransaction should have set storedMarks
    const storedMarks = newState.storedMarks;
    expect(storedMarks).not.toBeNull();
    expect(storedMarks?.some((m) => m.type.name === "code")).toBe(true);
  });

  it("does not set storedMarks when cursor is NOT at code boundary", () => {
    const state = createStateWithPlugin("Hello ", "code", " world");

    // Move cursor to middle of "Hello " (position 4 = 1 + 3)
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 4));
    const newState = state.apply(tr);

    // Should NOT have code mark in storedMarks
    const storedMarks = newState.storedMarks;
    const hasCode = storedMarks?.some((m) => m.type.name === "code") ?? false;
    expect(hasCode).toBe(false);
  });

  it("does not set storedMarks when cursor is inside code (not at boundary)", () => {
    const state = createStateWithPlugin("Hello ", "code", " world");

    // Move cursor to middle of "code" (position 9 = 1 + 6 + 2)
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 9));
    const newState = state.apply(tr);

    // storedMarks should be null (normal mark resolution handles this)
    const storedMarks = newState.storedMarks;
    expect(storedMarks).toBeNull();
  });

  it("does not set storedMarks when there is a selection", () => {
    const state = createStateWithPlugin("Hello ", "code", " world");

    // Select across the boundary
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 5, 9));
    const newState = state.apply(tr);

    const storedMarks = newState.storedMarks;
    expect(storedMarks).toBeNull();
  });

  it("handles code mark at paragraph start", () => {
    // Code mark at very start of paragraph
    const state = createStateWithPlugin("", "code", " world");

    // Move cursor to position 1 (start of paragraph content)
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 1));
    const newState = state.apply(tr);

    // At start of paragraph, ProseMirror's inclusive should handle this,
    // but our plugin should also set storedMarks for consistency
    const storedMarks = newState.storedMarks;
    expect(storedMarks).not.toBeNull();
    expect(storedMarks?.some((m) => m.type.name === "code")).toBe(true);
  });
});
