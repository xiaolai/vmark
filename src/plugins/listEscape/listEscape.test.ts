// @vitest-environment node
/**
 * List Escape Handler Tests
 *
 * Tests for escapeListUp and escapeListDown — keyboard handlers
 * that prevent cursor trapping when a list is at a document edge.
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { escapeListUp, escapeListDown } from "./listEscape";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: { content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*" },
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

/** Create a bullet list with given item texts */
function bulletListDoc(...items: string[]) {
  return schema.node("doc", null, [
    schema.node(
      "bulletList",
      null,
      items.map((text) =>
        schema.node("listItem", null, [
          schema.node("paragraph", null, text ? [schema.text(text)] : []),
        ]),
      ),
    ),
  ]);
}

/** Create an ordered list with given item texts */
function orderedListDoc(...items: string[]) {
  return schema.node("doc", null, [
    schema.node(
      "orderedList",
      null,
      items.map((text) =>
        schema.node("listItem", null, [
          schema.node("paragraph", null, text ? [schema.text(text)] : []),
        ]),
      ),
    ),
  ]);
}

/** Paragraph then bullet list */
function paragraphThenListDoc(paraText: string, ...items: string[]) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, paraText ? [schema.text(paraText)] : []),
    schema.node(
      "bulletList",
      null,
      items.map((text) =>
        schema.node("listItem", null, [
          schema.node("paragraph", null, text ? [schema.text(text)] : []),
        ]),
      ),
    ),
  ]);
}

/** Bullet list then paragraph */
function listThenParagraphDoc(paraText: string, ...items: string[]) {
  return schema.node("doc", null, [
    schema.node(
      "bulletList",
      null,
      items.map((text) =>
        schema.node("listItem", null, [
          schema.node("paragraph", null, text ? [schema.text(text)] : []),
        ]),
      ),
    ),
    schema.node("paragraph", null, paraText ? [schema.text(paraText)] : []),
  ]);
}

/**
 * Get position of the start of the Nth list item's paragraph content (0-indexed).
 * Structure: bulletList(+1) > listItem(+1) > paragraph(+1) > text
 * Each listItem has nodeSize = 2 (open/close) + paragraph nodeSize (2 + textLen)
 */
function getItemStartPos(texts: string[], itemIndex: number): number {
  // bulletList opens at pos 0, its content starts at pos 1
  let pos = 1; // inside bulletList
  for (let i = 0; i < itemIndex; i++) {
    // listItem nodeSize = 2 + paragraph nodeSize = 2 + 2 + texts[i].length
    pos += 4 + texts[i].length;
  }
  // Now at start of target listItem
  // listItem(+1) > paragraph(+1) > content
  pos += 2;
  return pos;
}

/** Get position of the end of the Nth list item's paragraph content (0-indexed) */
function getItemEndPos(texts: string[], itemIndex: number): number {
  return getItemStartPos(texts, itemIndex) + texts[itemIndex].length;
}

describe("escapeListUp", () => {
  it("inserts paragraph before bullet list when it is first block and cursor is at start of first item", () => {
    const texts = ["hello", "world"];
    const doc = bulletListDoc(...texts);
    const startPos = getItemStartPos(texts, 0);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, startPos),
    });
    const view = createView(state);

    const handled = escapeListUp(view);

    expect(handled).toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();

    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("paragraph");
    expect(resultDoc.child(1).type.name).toBe("bulletList");
  });

  it("works with ordered list", () => {
    const texts = ["first"];
    const doc = orderedListDoc(...texts);
    const startPos = getItemStartPos(texts, 0);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, startPos),
    });
    const view = createView(state);

    const handled = escapeListUp(view);

    expect(handled).toBe(true);
    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("paragraph");
    expect(resultDoc.child(1).type.name).toBe("orderedList");
  });

  it("inserts paragraph before single empty list item", () => {
    const texts = [""];
    const doc = bulletListDoc(...texts);
    const startPos = getItemStartPos(texts, 0);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, startPos),
    });
    const view = createView(state);

    const handled = escapeListUp(view);

    expect(handled).toBe(true);
    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("paragraph");
  });

  it("places cursor inside the newly inserted paragraph", () => {
    const texts = ["hello"];
    const doc = bulletListDoc(...texts);
    const startPos = getItemStartPos(texts, 0);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, startPos),
    });
    const view = createView(state);

    escapeListUp(view);

    const sel = view.state.selection;
    expect(sel.$from.parent.type.name).toBe("paragraph");
    expect(sel.$from.node(1).type.name).toBe("paragraph");
  });

  it("does not handle when cursor is in second item (not first)", () => {
    const texts = ["hello", "world"];
    const doc = bulletListDoc(...texts);
    const startPos = getItemStartPos(texts, 1); // second item
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, startPos),
    });
    const view = createView(state);

    const handled = escapeListUp(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when cursor is not at start of first item", () => {
    const texts = ["hello"];
    const doc = bulletListDoc(...texts);
    // Cursor in middle of "hello"
    const midPos = getItemStartPos(texts, 0) + 3;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, midPos),
    });
    const view = createView(state);

    const handled = escapeListUp(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when list is not the first block", () => {
    const doc = paragraphThenListDoc("before", "item1");
    // paragraph nodeSize = 2 + 6 = 8
    // bulletList starts at 8, then listItem(+1) > paragraph(+1) = +2
    const startPos = 8 + 1 + 1 + 1; // bulletList(+1) > listItem(+1) > paragraph(+1)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, startPos),
    });
    const view = createView(state);

    const handled = escapeListUp(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when cursor is not inside a list", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("plain text")]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    const view = createView(state);

    const handled = escapeListUp(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("escapeListDown", () => {
  it("inserts paragraph after bullet list when it is last block and cursor is at end of last item", () => {
    const texts = ["hello", "world"];
    const doc = bulletListDoc(...texts);
    const endPos = getItemEndPos(texts, texts.length - 1);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();

    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("bulletList");
    expect(resultDoc.child(1).type.name).toBe("paragraph");
  });

  it("works with ordered list", () => {
    const texts = ["only item"];
    const doc = orderedListDoc(...texts);
    const endPos = getItemEndPos(texts, 0);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(true);
    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("orderedList");
    expect(resultDoc.child(1).type.name).toBe("paragraph");
  });

  it("inserts paragraph after single empty list item", () => {
    const texts = [""];
    const doc = bulletListDoc(...texts);
    const endPos = getItemEndPos(texts, 0);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(true);
    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(0).type.name).toBe("bulletList");
    expect(resultDoc.child(1).type.name).toBe("paragraph");
  });

  it("moves cursor into the newly inserted paragraph", () => {
    const texts = ["hello"];
    const doc = bulletListDoc(...texts);
    const endPos = getItemEndPos(texts, 0);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    escapeListDown(view);

    const sel = view.state.selection;
    // Cursor should be in the new paragraph after the list
    expect(sel.$from.node(1).type.name).toBe("paragraph");
  });

  it("does not handle when cursor is in first item (not last) of multi-item list", () => {
    const texts = ["hello", "world"];
    const doc = bulletListDoc(...texts);
    const endPos = getItemEndPos(texts, 0); // end of first item
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when cursor is not at end of last item", () => {
    const texts = ["hello"];
    const doc = bulletListDoc(...texts);
    // Cursor at start of item, not end
    const startPos = getItemStartPos(texts, 0);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, startPos),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when list is not the last block", () => {
    const doc = listThenParagraphDoc("after", "item1");
    // End of first (only) list item content
    // bulletList(+1) > listItem(+1) > paragraph(+1) > "item1" end = 3 + 5 = 8
    const endPos = 3 + "item1".length;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not handle when cursor is not inside a list", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("plain text")]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 5),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("handles three-item list — escape from last item", () => {
    const texts = ["one", "two", "three"];
    const doc = bulletListDoc(...texts);
    const endPos = getItemEndPos(texts, 2);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(true);
    const resultDoc = view.state.doc;
    expect(resultDoc.childCount).toBe(2);
    expect(resultDoc.child(1).type.name).toBe("paragraph");
  });

  it("does not handle when cursor is in middle item of three-item list", () => {
    const texts = ["one", "two", "three"];
    const doc = bulletListDoc(...texts);
    const endPos = getItemEndPos(texts, 1); // end of second item
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view = createView(state);

    const handled = escapeListDown(view);

    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Edge-case: schema without a paragraph type (lines 135 and 168 guard)
// ──────────────────────────────────────────────────────────────────────

describe("escapeListUp — schema without paragraph type returns false", () => {
  // Build a minimal schema that has lists but NO paragraph node.
  // This exercises the `if (!paragraphType) return false` guard (line 135).
  const noParagraphSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      bulletList: { content: "listItem+", group: "block" },
      listItem: { content: "text*" },
      text: { inline: true },
    },
  });

  it("returns false when schema has no paragraph node", () => {
    // Build: bulletList > listItem > text("hi")
    const listItem = noParagraphSchema.nodes.listItem.create(
      null,
      [noParagraphSchema.text("hi")]
    );
    const doc = noParagraphSchema.nodes.doc.create(null, [
      noParagraphSchema.nodes.bulletList.create(null, [listItem]),
    ]);
    // Cursor at position 2 — inside the listItem text
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });
    const view: import("@tiptap/pm/view").EditorView = {
      get state() { return state; },
      dispatch: vi.fn(),
      focus: vi.fn(),
    } as unknown as import("@tiptap/pm/view").EditorView;

    const handled = escapeListUp(view);

    // Cannot insert paragraph because schema lacks the type → returns false
    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("escapeListDown — schema without paragraph type returns false", () => {
  // Same minimal schema — exercises the `if (!paragraphType) return false` guard (line 168).
  const noParagraphSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      bulletList: { content: "listItem+", group: "block" },
      listItem: { content: "text*" },
      text: { inline: true },
    },
  });

  it("returns false when schema has no paragraph node", () => {
    const listItem = noParagraphSchema.nodes.listItem.create(
      null,
      [noParagraphSchema.text("hi")]
    );
    const doc = noParagraphSchema.nodes.doc.create(null, [
      noParagraphSchema.nodes.bulletList.create(null, [listItem]),
    ]);
    // listItem text is "hi" (2 chars); end of content is at pos 4
    // (doc(1) > bulletList(1) > listItem(1) > text = pos 3; end at pos 3+2=5 - 1 = 4)
    const endPos = doc.content.size - 2; // near end of content
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, endPos),
    });
    const view: import("@tiptap/pm/view").EditorView = {
      get state() { return state; },
      dispatch: vi.fn(),
      focus: vi.fn(),
    } as unknown as import("@tiptap/pm/view").EditorView;

    const handled = escapeListDown(view);

    // Cannot insert paragraph because schema lacks the type → returns false
    expect(handled).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});
