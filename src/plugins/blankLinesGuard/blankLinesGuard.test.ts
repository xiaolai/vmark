// Edit-propagation guard for blankLinesBefore (plan ADR-5 / WI-1.5).
// ProseMirror's split copies node attributes to BOTH halves, so a paragraph
// carrying blankLinesBefore=3 would give the newly-created second paragraph 3
// too — emitting 3 spurious blank lines on the next serialize. This plugin
// nulls blankLinesBefore on blocks created by an edit (split, paste), while
// leaving parse-captured values and in-place content edits untouched.
import { describe, it, expect, beforeEach } from "vitest";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { blankLinesGuard } from "./blankLinesGuard";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      attrs: { blankLinesBefore: { default: null } },
      content: "inline*",
      group: "block",
    },
    text: { group: "inline" },
  },
});

function docWith(...paras: Array<{ text: string; blank?: number | null }>): PMNode {
  return schema.node(
    "doc",
    null,
    paras.map((p) =>
      schema.node("paragraph", { blankLinesBefore: p.blank ?? null }, p.text ? [schema.text(p.text)] : []),
    ),
  );
}

function stateFor(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc, plugins: [blankLinesGuard()] });
}

function blanksOf(state: EditorState): Array<number | null> {
  const out: Array<number | null> = [];
  state.doc.forEach((n) => out.push(n.attrs.blankLinesBefore));
  return out;
}

describe("blankLinesGuard", () => {
  let state: EditorState;

  beforeEach(() => {
    // One paragraph "Hello" carrying a captured run of 3 blank lines before it.
    state = stateFor(docWith({ text: "Hello", blank: 3 }));
  });

  it("nulls blankLinesBefore on the new block created by a split", () => {
    // Split "Hello" after "He" → ["He"(keeps 3), "llo"(new, must be null)].
    const splitPos = 1 + 2; // inside the paragraph, after "He"
    const tr = state.tr.setSelection(TextSelection.create(state.doc, splitPos)).split(splitPos);
    const next = state.apply(tr);

    expect(blanksOf(next)).toEqual([3, null]);
  });

  it("leaves blankLinesBefore untouched on an in-place content edit", () => {
    // Type a char inside "Hello" — the block is not newly created.
    const tr = state.tr.insertText("!", 1 + 5);
    const next = state.apply(tr);

    expect(blanksOf(next)).toEqual([3]);
  });

  it("nulls blankLinesBefore on pasted/inserted blocks", () => {
    // Insert a new paragraph (carrying a stray value) after the first.
    const insertAt = state.doc.child(0).nodeSize;
    const pasted = schema.node("paragraph", { blankLinesBefore: 5 }, [schema.text("Pasted")]);
    const tr = state.tr.insert(insertAt, pasted);
    const next = state.apply(tr);

    expect(blanksOf(next)).toEqual([3, null]);
  });

  it("does nothing on a selection-only transaction", () => {
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 2));
    const next = state.apply(tr);
    expect(blanksOf(next)).toEqual([3]);
  });
});
