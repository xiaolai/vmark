// @vitest-environment node
/**
 * Blockquote Escape Handler Tests
 *
 * Tests for escapeBlockquoteUp and escapeBlockquoteDown — keyboard handlers
 * that prevent cursor trapping when a blockquote is at a document edge.
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { escapeBlockquoteUp, escapeBlockquoteDown } from "./blockquoteEscape";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    blockquote: { content: "block+", group: "block" },
    text: { inline: true },
  },
});

/**
 * Create a mock EditorView with the given state.
 * dispatch applies the transaction so we can inspect the resulting state.
 */
function createView(state: EditorState): EditorView {
  let currentState = state;
  const view = {
    get state() {
      return currentState;
    },
    dispatch: vi.fn((tr) => {
      currentState = currentState.apply(tr);
    }),
    focus: vi.fn(),
  } as unknown as EditorView;
  return view;
}

/** Doc containing only a blockquote with the given text */
function blockquoteOnlyDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("blockquote", null, [
      schema.node("paragraph", null, text ? [schema.text(text)] : []),
    ]),
  ]);
}

/** Paragraph before blockquote */
function paragraphThenBlockquoteDoc(paraText: string, bqText: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, paraText ? [schema.text(paraText)] : []),
    schema.node("blockquote", null, [
      schema.node("paragraph", null, bqText ? [schema.text(bqText)] : []),
    ]),
  ]);
}

/** Blockquote then paragraph */
function blockquoteThenParagraphDoc(bqText: string, paraText: string) {
  return schema.node("doc", null, [
    schema.node("blockquote", null, [
      schema.node("paragraph", null, bqText ? [schema.text(bqText)] : []),
    ]),
    schema.node("paragraph", null, paraText ? [schema.text(paraText)] : []),
  ]);
}

describe("escapeBlockquoteUp", () => {
  it("inserts paragraph before blockquote when it is first block and cursor is at start", () => {
    const doc = blockquoteOnlyDoc("hello");
    // Cursor at start of blockquote content: doc(0) > blockquote(+1) > paragraph(+1) = pos 2
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });
    const view = createView(state);

    const handled = escapeBlockquoteUp(view);

    expect(handled).toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();

    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("paragraph");
    expect(resultDoc.child(1).type.name).toBe("blockquote");
  });

  it("inserts paragraph before empty blockquote at document start", () => {
    const doc = blockquoteOnlyDoc("");
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });
    const view = createView(state);

    const handled = escapeBlockquoteUp(view);

    expect(handled).toBe(true);
    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("paragraph");
    expect(resultDoc.child(1).type.name).toBe("blockquote");
  });

  it("places cursor inside the newly inserted paragraph", () => {
    const doc = blockquoteOnlyDoc("hello");
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });
    const view = createView(state);

    escapeBlockquoteUp(view);

    const sel = view.state.selection;
    // Cursor should be inside the new paragraph (first child of doc)
    expect(sel.$from.parent.type.name).toBe("paragraph");
    expect(sel.$from.node(1).type.name).toBe("paragraph");
  });

  it("does not handle when cursor is not at start of blockquote", () => {
    const doc = blockquoteOnlyDoc("hello");
    // Cursor in the middle of "hello": pos 2 + 3 = 5
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 5),
    });
    const view = createView(state);

    const handled = escapeBlockquoteUp(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when blockquote is not the first block", () => {
    const doc = paragraphThenBlockquoteDoc("before", "inside");
    // paragraph node size = 2 + 6 = 8, so blockquote starts at pos 8
    // cursor inside blockquote content: 8 + 1 + 1 = 10
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 10),
    });
    const view = createView(state);

    const handled = escapeBlockquoteUp(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when cursor is not inside a blockquote", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("plain text")]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    const view = createView(state);

    const handled = escapeBlockquoteUp(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("nested blockquote — finds innermost blockquote first, does not escape", () => {
    // blockquote > blockquote > paragraph
    const doc = schema.node("doc", null, [
      schema.node("blockquote", null, [
        schema.node("blockquote", null, [
          schema.node("paragraph", null, [schema.text("nested")]),
        ]),
      ]),
    ]);
    // Cursor at start of innermost paragraph: doc > outer_bq(+1) > inner_bq(+1) > para(+1) = pos 3
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });
    const view = createView(state);

    // The loop walks from deepest to shallowest; finds inner blockquote at pos 1, not 0
    const handled = escapeBlockquoteUp(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("escapeBlockquoteDown", () => {
  it("inserts paragraph after blockquote when it is last block and cursor is at end", () => {
    const doc = blockquoteOnlyDoc("hello");
    // End of paragraph content inside blockquote: 2 + "hello".length = 7
    const endPos = 2 + "hello".length;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeBlockquoteDown(view);

    expect(handled).toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();

    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("blockquote");
    expect(resultDoc.child(1).type.name).toBe("paragraph");
  });

  it("inserts paragraph after empty blockquote at document end", () => {
    const doc = blockquoteOnlyDoc("");
    // Empty blockquote: cursor at pos 2
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });
    const view = createView(state);

    const handled = escapeBlockquoteDown(view);

    expect(handled).toBe(true);
    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("blockquote");
    expect(resultDoc.child(1).type.name).toBe("paragraph");
  });

  it("moves cursor into the newly inserted paragraph", () => {
    const doc = blockquoteOnlyDoc("hello");
    const endPos = 2 + "hello".length;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    escapeBlockquoteDown(view);

    const sel = view.state.selection;
    // The new paragraph is the second child of doc
    expect(sel.$from.node(1).type.name).toBe("paragraph");
  });

  it("does not handle when cursor is not at end of blockquote", () => {
    const doc = blockquoteOnlyDoc("hello");
    // Cursor at start (pos 2), not at end
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });
    const view = createView(state);

    const handled = escapeBlockquoteDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when blockquote is not the last block", () => {
    const doc = blockquoteThenParagraphDoc("inside", "after");
    // End of blockquote content: 2 + "inside".length = 8
    const endPos = 2 + "inside".length;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeBlockquoteDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when cursor is not inside a blockquote", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("plain text")]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 5),
    });
    const view = createView(state);

    const handled = escapeBlockquoteDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("handles blockquote with multiple paragraphs — cursor at end of last paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("blockquote", null, [
        schema.node("paragraph", null, [schema.text("first")]),
        schema.node("paragraph", null, [schema.text("second")]),
      ]),
    ]);
    // blockquote(+1) > para1("first", size=7) > para2_open(+1) > "second"
    // pos = 1 + 7 + 1 + "second".length = 1 + 7 + 1 + 6 = 15
    const endPos = 1 + (2 + "first".length) + 1 + "second".length;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeBlockquoteDown(view);

    expect(handled).toBe(true);
    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(1).type.name).toBe("paragraph");
  });

  it("does not handle when cursor is at end of first paragraph in multi-paragraph blockquote", () => {
    const doc = schema.node("doc", null, [
      schema.node("blockquote", null, [
        schema.node("paragraph", null, [schema.text("first")]),
        schema.node("paragraph", null, [schema.text("second")]),
      ]),
    ]);
    // End of first paragraph: 1 + 1 + "first".length = 7
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 7),
    });
    const view = createView(state);

    // Cursor is not at end of blockquote (there is a second paragraph after)
    const handled = escapeBlockquoteDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("returns false when blockquoteNode is null in isAtEndOfBlockquote", () => {
    // This covers line 65: `if (!info.blockquoteNode) return false;` in escapeBlockquoteDown
    // We test it by making getBlockquoteInfo return an info with null blockquoteNode.
    // Since getBlockquoteInfo won't normally return null blockquoteNode from a real doc,
    // we test the guard indirectly — when cursor is not inside a blockquote
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("no blockquote")]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    const view = createView(state);
    expect(escapeBlockquoteDown(view)).toBe(false);
  });

  it("returns false for escapeBlockquoteDown when schema lacks paragraph type", () => {
    // Create a schema without paragraph type to test line 133 guard
    const schemaWithoutParagraph = new Schema({
      nodes: {
        doc: { content: "blockquote+" },
        blockquote: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });
    const doc = schemaWithoutParagraph.node("doc", null, [
      schemaWithoutParagraph.node("blockquote", null, [
        schemaWithoutParagraph.text("hello"),
      ]),
    ]);
    // Cursor must be at end of blockquote to pass isAtEndOfBlockquote check
    // blockquote spans pos 0..7, text "hello" at pos 1..6, end of text = pos 6
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 6),
    });
    const view = createView(state);
    // getBlockquoteInfo finds blockquote, isAtEndOfBlockquote returns true,
    // isBlockquoteLastBlock returns true, but paragraphType is undefined → false
    const handled = escapeBlockquoteDown(view);
    expect(handled).toBe(false);
  });

  it("returns false for escapeBlockquoteUp when schema lacks paragraph type", () => {
    // Test line 103 guard: `if (!paragraphType) return false;`
    const schemaWithoutParagraph = new Schema({
      nodes: {
        doc: { content: "blockquote+" },
        blockquote: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });
    const doc = schemaWithoutParagraph.node("doc", null, [
      schemaWithoutParagraph.node("blockquote", null, [
        schemaWithoutParagraph.text("hello"),
      ]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    const view = createView(state);
    const handled = escapeBlockquoteUp(view);
    expect(handled).toBe(false);
  });
});
